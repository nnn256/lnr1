import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from local_history import LocalHistoryStore
from tdx_api_client import TdxAPIClient


class IntegrationContracts(unittest.TestCase):
    def test_future_daily_dates_from_upstream_are_rejected(self):
        api=TdxAPIClient()
        payload={'list':[dict(Time='2276-06-26T00:00:00Z',Open=10000,High=11000,Low=9000,Close=10000,Volume=10)]}
        with patch.object(api,'request',return_value=payload):
            with self.assertRaisesRegex(ValueError,'future daily date'):
                api.history('sz000001',2)

    def test_concurrent_chart_requests_share_one_refresh(self):
        import datetime as dt
        import time
        from concurrent.futures import ThreadPoolExecutor
        from market_runtime import MarketAPI,normalize_bars,now
        with tempfile.TemporaryDirectory() as folder:
            api=MarketAPI(folder)
            data=normalize_bars([dict(date=(dt.date(2026,1,1)+dt.timedelta(days=i)).isoformat(),open=10,high=12,low=9,close=11,volume=10) for i in range(120)],120)
            def fetch(*args):
                time.sleep(.05)
                return dict(ok=True,code='000530',bars=data,source='tdx-api',adjusted=False,received_at=now(),first_date=data[0]['date'],last_date=data[-1]['date'])
            try:
                with patch.object(api,'_ensure_tdx_api'),patch.object(api,'fetch_bars',side_effect=fetch) as call,patch.object(api,'_reference_market_day',return_value=data[-1]['date']):
                    with ThreadPoolExecutor(max_workers=2) as pool:
                        results=list(pool.map(lambda _:api.get_chart_history('000530',120),range(2)))
                    self.assertTrue(all(result['ok'] for result in results))
                    self.assertEqual(call.call_count,1)
                    self.assertEqual(sum(result['cached'] for result in results),1)
            finally:
                for handler in api.log.handlers[:]:handler.close();api.log.removeHandler(handler)
    def test_native_chart_export_stays_in_export_folder_and_never_overwrites(self):
        import base64
        from market_runtime import MarketAPI
        with tempfile.TemporaryDirectory() as folder:
            api = MarketAPI(Path(folder) / 'data')
            raw = json.dumps(dict(schema='test-export', execution_allowed=False)).encode()
            encoded = base64.b64encode(raw).decode()
            first = api.save_chart_export('liangce-tradingview-600519.json', encoded)
            second = api.save_chart_export('liangce-tradingview-600519.json', encoded)
            self.assertTrue(first['ok'])
            self.assertTrue(second['ok'])
            self.assertNotEqual(first['path'], second['path'])
            self.assertEqual(Path(first['path']).read_bytes(), raw)
            self.assertEqual(Path(first['path']).parent, Path(folder) / 'exports')
            self.assertFalse(api.save_chart_export('../outside.json', encoded)['ok'])
            self.assertFalse(api.save_chart_export('liangce-invalid.png', encoded)['ok'])
            for handler in api.log.handlers[:]:
                handler.close();api.log.removeHandler(handler)
    def test_offline_history_keeps_original_price_basis_and_marks_delay(self):
        import datetime as dt
        from market_runtime import MarketAPI
        with tempfile.TemporaryDirectory() as folder:
            api = MarketAPI(folder)
            bars = [dict(date=(dt.date(2025,1,1)+dt.timedelta(days=i)).isoformat(),open=10,high=12,low=9,close=11,volume=100) for i in range(120)]
            local = dict(code='600519', name='贵州茅台', bars=bars, source='local-test', adjusted=True)
            try:
                with patch.object(api.local,'read',return_value=local), patch.object(api,'_ensure_tdx_api',side_effect=ConnectionError('offline')):
                    result=api.get_chart_history('600519',100)
                self.assertTrue(result['ok'])
                self.assertTrue(result['adjusted'])
                self.assertEqual(result['history_freshness'],'stale_fallback')
                self.assertEqual(result['source'],'local-test')
                self.assertEqual(len(result['bars']),100)
                self.assertEqual(len(result['input_sha256']),64)
                self.assertNotIn('checked_at',result)
                self.assertFalse(api.get_chart_history('not-stock')['ok'])
            finally:
                for handler in api.log.handlers[:]:handler.close();api.log.removeHandler(handler)

    def test_live_history_replaces_stale_cache_and_repeated_load_reuses_verified_data(self):
        import datetime as dt
        from market_runtime import MarketAPI,normalize_bars,now
        with tempfile.TemporaryDirectory() as folder:
            api=MarketAPI(folder)
            raw=[dict(date=(dt.date(2026,7,10)+dt.timedelta(days=i)).isoformat(),open=20,high=22,low=19,close=21,volume=2) for i in range(120)]
            live=normalize_bars(raw,120)
            old=dict(code='000530',bars=live[:100],adjusted=True,history_freshness='cache_unverified')
            api._write('daily-000530.json',old)
            response=dict(ok=True,code='000530',bars=live,source='tdx-api 历史日线',adjusted=False,received_at=now(),first_date=live[0]['date'],last_date=live[-1]['date'])
            try:
                with patch.object(api,'_ensure_tdx_api'),patch.object(api,'fetch_bars',return_value=response) as fetch,patch.object(api,'_reference_market_day',return_value=live[-1]['date']),patch.object(api.local,'read') as local:
                    first=api.get_chart_history('000530',120)
                    second=api.get_chart_history('000530',120)
                    self.assertEqual(first['history_freshness'],'verified')
                    self.assertEqual(first['last_date'],live[-1]['date'])
                    self.assertFalse(first['adjusted'])
                    self.assertTrue(second['cached'])
                    self.assertEqual(len(second['bars']),120)
                    self.assertEqual(fetch.call_count,1)
                    local.assert_not_called()
                    api.get_chart_history('000530',120,True)
                    self.assertEqual(fetch.call_count,2)
                self.assertEqual(api.get_history('000530')['last_date'],live[-1]['date'])
            finally:
                for handler in api.log.handlers[:]:handler.close();api.log.removeHandler(handler)

    def test_server_older_than_market_is_explicit_lag_without_fake_bars(self):
        import datetime as dt
        from market_runtime import MarketAPI,normalize_bars,now
        with tempfile.TemporaryDirectory() as folder:
            api=MarketAPI(folder)
            bars=normalize_bars([dict(date=(dt.date(2026,1,1)+dt.timedelta(days=i)).isoformat(),open=10,high=12,low=9,close=11,volume=100) for i in range(120)],120)
            try:
                with patch.object(api,'_ensure_tdx_api'),patch.object(api,'fetch_bars',return_value=dict(ok=True,code='000530',bars=bars,source='tdx-api',adjusted=False,received_at=now(),first_date=bars[0]['date'],last_date=bars[-1]['date'])),patch.object(api,'_reference_market_day',return_value='2026-11-06'):
                    result=api.get_chart_history('000530',120)
                self.assertEqual(result['history_freshness'],'market_lag')
                self.assertEqual(result['last_date'],bars[-1]['date'])
                self.assertEqual(len(result['bars']),120)
                self.assertEqual(result['market_last_date'],'2026-11-06')
            finally:
                for handler in api.log.handlers[:]:handler.close();api.log.removeHandler(handler)

    def test_nested_milliyuan_quotes_and_requested_codes(self):
        names = {'sh600519': dict(name='贵州茅台')}
        raw = dict(Code='600519', Exchange=1, K=dict(Close=1452000, Last=1446440), TotalHand=46712, Amount=6752970752)
        row = TdxAPIClient.quote(raw, names)
        self.assertEqual(row['price'], 1452)
        self.assertEqual(row['volume'], 46712)
        self.assertEqual(row['amount'], 6752970752)
        with self.assertRaises(ValueError):
            TdxAPIClient.quote(dict(raw, Code='600000'), names)

    def test_full_market_requests_use_fifty_per_batch(self):
        api = TdxAPIClient()
        names = {f'sh{600000+i}': dict(code=str(600000+i), exchange='sh', name=str(i)) for i in range(123)}
        calls = []
        def request(path, payload):
            self.assertEqual(path, '/api/batch-quote')
            calls.append(len(payload['codes']))
            return [dict(Code=code[2:], Exchange=1, K=dict(Close=11000, Last=10000), TotalHand=100, Amount=1100) for code in payload['codes']]
        with patch.object(api, 'codes', return_value=names), patch.object(api, 'request', side_effect=request):
            result = api.scan()
        self.assertEqual(calls, [50, 50, 23])
        self.assertEqual(result['total_quotes'], 123)
        self.assertEqual(len(result['securities']),123)
        self.assertEqual(result['securities'][0]['exchange'],'sh')
        self.assertEqual(result['failed_batches'], [])

    def test_business_error_with_http_200_is_rejected(self):
        from io import BytesIO
        with patch('urllib.request.urlopen', return_value=BytesIO(json.dumps(dict(code=-1,message='limit',data=None)).encode())):
            with self.assertRaisesRegex(ValueError, 'limit'):
                TdxAPIClient().request('/api/batch-quote', {'codes': ['sh600519'] * 51})

    def test_sqlite_history_readonly_and_share_unit(self):
        with tempfile.TemporaryDirectory() as folder:
            db = Path(folder) / 'MiQuant.db'
            connection = sqlite3.connect(db)
            connection.execute('CREATE TABLE daily_kline(symbol,trade_date,open,high,low,close,volume,source)')
            import datetime as dt
            rows = [('sh600519', (dt.date(2025, 1, 1)+dt.timedelta(days=i)).isoformat(),10,12,9,11,123400,'tdx_hsjday') for i in range(120)]
            connection.executemany('INSERT INTO daily_kline VALUES (?,?,?,?,?,?,?,?)', rows)
            connection.execute('INSERT INTO daily_kline VALUES (?,?,?,?,?,?,?,?)', ('bj920085','2026-11-06',10,12,9,11,10000,'tdx_hsjday'))
            connection.commit();connection.close()
            before = hashlib.sha256(db.read_bytes()).hexdigest()
            result = LocalHistoryStore([folder]).read('600519', 100)
            self.assertEqual(len(result['bars']),100)
            self.assertEqual(result['bars'][-1]['volume'],1234)
            self.assertFalse(result['adjusted'])
            short=LocalHistoryStore([folder]).read('920085',1200)
            self.assertEqual(len(short['bars']),1)
            self.assertEqual(short['bars'][0]['volume'],100)
            self.assertEqual(hashlib.sha256(db.read_bytes()).hexdigest(),before)


if __name__ == '__main__':
    unittest.main()
