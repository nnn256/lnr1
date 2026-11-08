import datetime as dt
import tempfile
import unittest
from unittest.mock import patch
from market_runtime import MarketAPI, normalize_market, normalize_bars, parse_bridge


def bars():
    return [dict(date=(dt.date(2025, 1, 1) + dt.timedelta(days=i)).isoformat(),
                 open=10, high=12, low=9, close=11, volume=1000) for i in range(120)]


class MarketTests(unittest.TestCase):
    def test_bridge_change_field_and_invalid_prices(self):
        result = normalize_market(dict(total_codes=5, rows=[
            dict(code='600000', price=10, previous_close=8, change_percent=25),
            dict(code='600001', price=0), dict(code='600002', price='NaN')]))
        self.assertEqual(result['total_quotes'], 1)
        self.assertEqual(result['rows'][0]['change'], 25)
        self.assertEqual(result['total_codes'], 5)
        with self.assertRaises(ValueError):
            normalize_market(dict(ok=True, rows=[]))

    def test_history_validation_order_and_deduplication(self):
        raw = bars()[::-1] + [bars()[0], dict(date='invalid')]
        result = normalize_bars(raw, 100)
        self.assertEqual(len(result), 100)
        self.assertLess(result[0]['date'], result[-1]['date'])
        self.assertEqual(result[-1]['prevClose'], result[-2]['close'])
        with self.assertRaises(ValueError):
            normalize_bars([dict(date='2025-01-01', open=10, high=9, low=8, close=11, volume=1)], 100)

    def test_bridge_logs_are_not_mistaken_for_payload(self):
        self.assertEqual(parse_bridge(b'noise\n{"ok":true}\n'), {'ok': True})
        with self.assertRaises(ValueError):
            parse_bridge(b'only logs')

    def test_valid_short_history_is_collected_even_before_indicator_warmup(self):
        self.assertEqual(len(normalize_bars(bars()[:1],1200)),1)
        self.assertEqual(len(normalize_bars(bars()[:68],1200)),68)
        with self.assertRaises(ValueError):normalize_bars([],1200)

    def test_restart_restores_history_without_network(self):
        with tempfile.TemporaryDirectory() as folder:
            api = MarketAPI(folder, history_count=100)
            raw = bars()
            api._write('daily-600000.json', dict(code='600000', name='A', bars=raw, received_at='2026-11-05T15:00:00+08:00'))
            restarted = MarketAPI(folder, history_count=100)
            history = restarted.get_state()['histories'][0]
            self.assertTrue(history['cached'])
            self.assertEqual(len(history['bars']), 100)
            self.assertEqual(history['last_date'], raw[-1]['date'])
            for instance in (api, restarted):
                for handler in instance.log.handlers[:]:
                    handler.close()
                    instance.log.removeHandler(handler)

    def test_quote_refresh_does_not_reset_history_or_restart_analysis(self):
        with tempfile.TemporaryDirectory() as folder:
            api=MarketAPI(folder,history_count=100)
            market=normalize_market(dict(rows=[dict(code='600000',name='A',price=10,amount=100)]))
            market['server']='test-server'
            api.state['histories']=[dict(code='600000',bars=bars())]
            api.batch.results={'600000':{'code':'600000'}}
            try:
                with patch.object(api,'scan_auto',return_value=market):api.run_cycle()
                self.assertEqual(api.get_state()['phase'],'ready')
                self.assertEqual(len(api.state['histories']),1)
                self.assertEqual(len(api.batch.results),1)
                self.assertTrue(api.batch.wake.is_set())
                with patch.object(api,'scan_auto',side_effect=ConnectionError('offline')):
                    with self.assertRaises(ConnectionError):api.run_cycle()
                self.assertEqual(len(api.state['histories']),1)
            finally:
                api.close()
                for handler in api.log.handlers[:]:handler.close();api.log.removeHandler(handler)


if __name__ == '__main__':
    unittest.main()
