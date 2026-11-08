import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from market_runtime import MarketAPI

def bars(n=120):
    return [dict(date=(dt.date(2026,1,1)+dt.timedelta(days=i)).isoformat(),open=10,high=12,low=9,close=11,volume=1000) for i in range(n)]

class BatchTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.api=MarketAPI(self.temp.name,history_count=120)
        self.batch=self.api.batch
        self.batch.params={}
        self.market=dict(cached=False,securities=[dict(code=str(600000+i),name='fixture',exchange='sh') for i in range(50)],rows=[])
        self.api.state['market']=self.market
        self.patches=[patch.object(self.api,'_reference_market_day',return_value=bars()[-1]['date']),
                      patch.object(self.api.tdx,'batch_history',side_effect=self.fetch)]
        for item in self.patches:item.start()
        self.calls=[]
    def tearDown(self):
        self.api.close()
        for item in self.patches:item.stop()
        for handler in self.api.log.handlers[:]:handler.close();self.api.log.removeHandler(handler)
        self.temp.cleanup()
    def fetch(self,codes,count):
        self.calls.extend(codes)
        return {code:{'bars':bars(68) if code.endswith('600049') else bars()} for code in codes}
    def ack(self):
        state=self.batch.poll(-1);batch=state['batch']
        summaries=[dict(code=h['code'],bar=h['bars'][-1],input_sha256=h['input_sha256'],signal=dict(score=40)) for h in batch['histories']]
        return self.batch.acknowledge(state['run_id'],batch['token'],summaries,[])
    def test_queue_advances_past_first16_and_only_counts_acknowledged_scores(self):
        self.batch._step()
        self.assertEqual(len(self.batch.pending['histories']),24)
        self.assertEqual(self.batch.snapshot()['analysed'],0)
        self.assertTrue(self.ack()['ok'])
        self.batch._step();self.ack()
        self.batch._step();self.ack()
        self.batch._step()
        p=self.batch.snapshot()
        self.assertEqual(p['total'],50);self.assertEqual(p['analysed'],49)
        self.assertEqual(p['failed'],0);self.assertEqual(p['short_history'],1)
        self.assertEqual(p['downloaded'],50);self.assertEqual(p['failure_types'],{'short_history':1})
        self.assertEqual(p['phase'],'complete');self.assertEqual(len(set(self.calls)),50)
        self.assertEqual(len(self.api.state['histories']),0)
        self.batch._step();self.assertEqual(len(self.calls),50)
    def test_reload_restores_same_results_without_network_and_params_invalidate(self):
        self.batch._step();self.ack();key=self.batch.key
        from batch_analysis import BatchAnalysis
        restored=BatchAnalysis(self.api,self.batch.normalize,self.batch.base,self.batch.timezone)
        restored.params={};restored._setup(self.market,bars()[-1]['date'])
        self.assertEqual(restored.key,key);self.assertEqual(len(restored.results),24)
        self.assertEqual(restored.snapshot()['restored'],24)
        restored.params={'volumeRatio':2};restored._setup(self.market,bars()[-1]['date'])
        self.assertNotEqual(restored.key,key);self.assertEqual(len(restored.results),0)
    def test_pause_obsolete_and_partial_ack_cannot_drop_or_doublecount_work(self):
        self.batch.control('pause');self.batch._step();self.assertFalse(self.calls)
        self.batch.control('resume');self.batch._step();p=self.batch.pending
        self.assertFalse(self.batch.acknowledge('wrong',p['token'],[],[])['ok'])
        with self.assertRaises(ValueError):self.batch.acknowledge(self.batch.key,p['token'],[],[])
        self.assertEqual(len(self.batch.results),0);self.assertTrue(self.ack()['ok'])
        self.assertFalse(self.batch.acknowledge(self.batch.key,p['token'],[],[])['ok'])
        self.assertEqual(len(self.batch.results),24)
    def test_cached_members_still_score_when_other_batch_members_fail(self):
        cached=dict(code='600000',name='cached',bars=bars(),adjusted=False,
                    history_freshness='verified',checked_at=dt.datetime.now(self.batch.timezone).isoformat(),
                    market_last_date=bars()[-1]['date'],requested_count=120,last_date=bars()[-1]['date'])
        self.api._write('daily-600000.json',cached)
        with patch.object(self.api.tdx,'batch_history',side_effect=ConnectionError('offline')):
            histories,failures=self.batch._fetch(self.market['securities'][:2],bars()[-1]['date'])
        self.assertEqual([row['code'] for row in histories],['600000'])
        self.assertEqual(list(failures),['600001'])
        self.assertEqual(failures['600001']['kind'],'fetch_error')

    def test_short_history_is_saved_and_viewable_without_becoming_a_score(self):
        item=self.market['securities'][-1]
        histories,issues=self.batch._fetch([item],bars()[-1]['date'])
        self.assertEqual(histories,[])
        self.assertEqual(issues[item['code']]['bar_count'],68)
        self.assertTrue(issues[item['code']]['history_saved'])
        self.assertEqual(len(self.api._read('daily-600049.json')['bars']),68)
        with patch.object(self.api,'_ensure_tdx_api'),patch.object(self.api.tdx,'history',return_value=bars(68)):
            chart=self.api.get_chart_history(item['code'])
        self.assertTrue(chart['ok']);self.assertEqual(len(chart['bars']),68)
        self.assertFalse(chart['score_ready']);self.assertEqual(self.batch.results,{})

    def test_retry_bypasses_short_history_cache_and_promotes_when_ready(self):
        self.market['securities']=self.market['securities'][-1:]
        self.batch._step();self.batch._step()
        self.assertEqual(self.batch.snapshot()['short_history'],1)
        self.assertIsNotNone(self.batch._ready_cache(self.market['securities'][0],bars()[-1]['date']))
        self.batch.started-=1000
        self.batch.control('retry_failed')
        self.assertLess(self.batch.snapshot()['elapsed_seconds'],2)
        with patch.object(self.api.tdx,'batch_history',return_value={'sh600049':{'bars':bars()}}) as network:
            self.batch._step()
        network.assert_called_once()
        self.assertEqual(len(self.batch.pending['histories'][0]['bars']),120)
        self.ack();self.batch._step()
        self.assertEqual(self.batch.snapshot()['analysed'],1)
        self.assertEqual(self.batch.snapshot()['issues_count'],0)

    def test_old_short_history_failures_are_requeued_without_losing_scores(self):
        self.batch._setup(self.market,bars()[-1]['date'])
        self.batch.results={'600000':{'code':'600000'}}
        self.batch.failures={'600049':{'kind':'short_history','message':'only 68 valid daily bars'}}
        self.batch._save()
        from batch_analysis import BatchAnalysis
        restarted=BatchAnalysis(self.api,self.batch.normalize,self.batch.base,self.batch.timezone)
        restarted.params={};restarted._setup(self.market,bars()[-1]['date'])
        self.assertEqual(restarted.results,self.batch.results)
        self.assertEqual(restarted.failures,{})

    def test_network_error_retries_only_failed_members_and_empty_is_separate(self):
        with patch.object(self.api.tdx,'batch_history',side_effect=[
            {'sh600000':{'bars':bars(4)},'sh600001':{'error':'timeout'},'sh600002':{'bars':[]}},
            {'sh600001':{'bars':bars()}}]) as network:
            histories,issues=self.batch._fetch(self.market['securities'][:3],bars()[-1]['date'])
        self.assertEqual([row['code'] for row in histories],['600001'])
        self.assertEqual(issues['600000']['bar_count'],4)
        self.assertEqual(issues['600002']['kind'],'no_history')
        self.assertEqual(network.call_args_list[1].args[0],['sh600001'])
        self.assertIsNone(self.api._read('daily-600002.json'))

    def test_saved_short_history_survives_restart_and_issues_are_paginated(self):
        self.batch._setup(self.market,bars()[-1]['date'])
        self.batch.failures={f'{600000+i}':dict(kind='short_history',history_saved=True,bar_count=4) for i in range(51)}
        self.batch._save()
        from batch_analysis import BatchAnalysis
        restarted=BatchAnalysis(self.api,self.batch.normalize,self.batch.base,self.batch.timezone)
        restarted.params={};restarted._setup(self.market,bars()[-1]['date'])
        self.assertEqual(len(restarted.failures),50)
        self.assertEqual(len(self.batch.issues()['rows']),50)
        self.assertEqual(len(self.batch.issues(50)['rows']),1)

    def test_retry_during_fetch_does_not_commit_superseded_packet(self):
        def during_fetch(codes,count):
            self.batch.control('retry_failed')
            return {code:{'bars':bars()} for code in codes}
        with patch.object(self.api.tdx,'batch_history',side_effect=during_fetch):self.batch._step()
        self.assertIsNone(self.batch.pending)
        self.assertFalse(self.batch.results)

    def test_offline_chart_keeps_saved_short_history_and_marks_it_stale(self):
        self.api._write('daily-600000.json',dict(code='600000',name='fixture',bars=bars(4),adjusted=False))
        with patch.object(self.api,'_ensure_tdx_api',side_effect=ConnectionError('offline')),patch.object(self.api.local,'read',return_value=None):
            chart=self.api.get_chart_history('600000')
        self.assertTrue(chart['ok']);self.assertEqual(len(chart['bars']),4)
        self.assertFalse(chart['score_ready']);self.assertEqual(chart['history_freshness'],'stale_fallback')

if __name__=='__main__':unittest.main()
