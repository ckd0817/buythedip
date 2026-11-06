import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from concurrent.futures import Future
from urllib.error import HTTPError
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import api
from update_data import build_etf, fetch_etf, fetch_vol
from instruments import metadata, market_of, last_closed_day


class InstrumentTests(unittest.TestCase):
    def test_cn_hk_codes_currency_and_exchange_close(self):
        for text, expected in [('600519', '600519.SS'), ('sh600519', '600519.SS'), ('600519.SH', '600519.SS'), ('000001', '000001.SZ'), ('sz000001', '000001.SZ'), ('300750.SZ', '300750.SZ'), ('0700', '0700.HK'), ('00700', '0700.HK'), ('700.HK', '0700.HK'), ('hk09988', '9988.HK')]:
            self.assertEqual(api.normalize_symbol(text), expected)
        self.assertEqual((market_of('600519.SS'), metadata('600519.SS')['currency']), ('CN', 'CNY'))
        self.assertEqual((market_of('0700.HK'), metadata('0700.HK')['currency']), ('HK', 'HKD'))
        from datetime import datetime, timezone
        now = datetime(2026, 11, 4, 7, 45, tzinfo=timezone.utc)
        self.assertEqual(last_closed_day('600519.SS', now), '2026-11-04')
        self.assertEqual(last_closed_day('0700.HK', now), '2026-11-03')
        for code in ('0000.HK', '600519.SZ', '000001.SS'):
            with self.assertRaises(ValueError):
                api.normalize_symbol(code)

    def test_cn_hk_validate_provider_identity_and_use_adjusted_closes(self):
        from datetime import datetime, timezone
        for symbol, currency, zone in [('600519.SS', 'CNY', 'Asia/Shanghai'), ('0700.HK', 'HKD', 'Asia/Hong_Kong')]:
            value = {'chart': {'result': [{
                'meta': {'symbol': symbol, 'dataGranularity': '1d', 'instrumentType': 'EQUITY', 'currency': currency, 'exchangeTimezoneName': zone},
                'timestamp': [int(datetime(2026, 11, 3, 7, tzinfo=timezone.utc).timestamp())],
                'indicators': {'quote': [{'close': [100]}], 'adjclose': [{'adjclose': [80]}]},
            }], 'error': None}}
            with patch('update_data.download', return_value=json.dumps(value).encode()):
                _, rows = fetch_etf(symbol, require_full_history=False, validate_us=True, save_raw=False)
                self.assertEqual(rows[-1]['adjustedClose'], 80)
                self.assertEqual(build_etf(symbol, rows, {})['currency'], currency)
            value['chart']['result'][0]['meta']['symbol'] = 'OTHER'
            with patch('update_data.download', return_value=json.dumps(value).encode()):
                with self.assertRaisesRegex(ValueError, 'unsupported_instrument'):
                    fetch_etf(symbol, require_full_history=False, validate_us=True, save_raw=False)

    def test_symbol_validation_and_share_class(self):
        self.assertEqual(api.normalize_symbol(' brk.b '), 'BRK-B')
        self.assertEqual(api.normalize_symbol('nvda'), 'NVDA')
        for value in ('', '../etc', 'A/B', '^VIX', 'A%2FB', 'A' * 16):
            with self.assertRaises(ValueError):
                api.normalize_symbol(value)

    def test_new_listing_and_non_us_instrument(self):
        value = {'chart': {'result': [{
            'meta': {'dataGranularity': '1d', 'instrumentType': 'ETF', 'currency': 'USD', 'exchangeTimezoneName': 'America/New_York'},
            'timestamp': [1704294000, 1704380400],
            'indicators': {'quote': [{'close': [100, 90]}], 'adjclose': [{'adjclose': [100, 90]}]},
        }], 'error': None}}
        with patch('update_data.download', return_value=json.dumps(value).encode()):
            _, rows = fetch_etf('NEW', require_full_history=False, validate_us=True, save_raw=False)
            result = build_etf('NEW', rows, {})
            self.assertIsNone(result['volatilitySymbol'])
            self.assertEqual(result['windows']['3']['volatility'], {})
            self.assertIsNone(result['windows']['3']['index'])
            self.assertIsNone(result['windows']['3']['ma']['value'])
            with self.assertRaises(ValueError):
                fetch_etf('NEW', save_raw=False)
            value['chart']['result'][0]['meta']['instrumentType'] = 'CRYPTOCURRENCY'
        with patch('update_data.download', return_value=json.dumps(value).encode()):
            with self.assertRaisesRegex(ValueError, 'unsupported_instrument'):
                fetch_etf('NEW', require_full_history=False, validate_us=True, save_raw=False)

    def test_cboe_single_column_csv(self):
        with patch('update_data.download', return_value=b'DATE,GVZ\n01/02/2024,21.5\n01/03/2024,22.0\n'):
            _, rows = fetch_vol('GVZ', require_full_history=False)
            self.assertEqual(rows[-1]['value'], 22)

    def test_missing_and_stale_volatility_are_not_substituted(self):
        rows = [{'date': '2026-11-03', 'close': 90, 'adjustedClose': 90}]
        for history in ({}, {'VXAPL': []}, {'VXAPL': [{'date': '2026-10-20', 'value': 30}]}):
            result = build_etf('AAPL', rows, history)
            self.assertIsNone(result['volatilitySymbol'])
            self.assertIsNone(result['windows']['5']['chart'][0]['volatility'])

    def test_same_symbol_concurrent_requests_share_fetch(self):
        with tempfile.TemporaryDirectory() as directory:
            api.PENDING.clear()
            api.FAILURES.clear()
            calls = []
            def refresh(symbol):
                calls.append(symbol)
                time.sleep(.05)
                return {'symbol': symbol}
            with patch.object(api, 'CACHE', Path(directory)), patch.object(api, 'SNAPSHOT', Path(directory) / 'missing'), patch.object(api, 'refresh', side_effect=refresh):
                results = []
                threads = [threading.Thread(target=lambda: results.append(api.instrument('TEST'))) for _ in range(4)]
                for thread in threads:
                    thread.start()
                for thread in threads:
                    thread.join()
                self.assertEqual(calls, ['TEST'])
                self.assertEqual(len(results), 4)

    def test_closing_day_cache_survives_old_six_hour_expiry(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            entry = {'version': api.CALCULATION_VERSION, 'asOf': api.last_closed_day(), 'created': time.time() - 80000, 'data': {'symbol': 'TEST'}}
            api.write_json(root / 'TEST.json', entry)
            with patch.object(api, 'CACHE', root), patch.object(api, 'SNAPSHOT', root / 'missing'), patch.object(api, 'refresh') as fetch:
                self.assertEqual(api.instrument('TEST'), {'symbol': 'TEST'})
                self.assertEqual(api.instrument('TEST'), {'symbol': 'TEST'})
                fetch.assert_not_called()

    def test_recalculation_reuses_saved_precise_prices(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            rows = [{'date': '2026-11-02', 'close': 100, 'adjustedClose': 99.12345678}, {'date': '2026-11-03', 'close': 90, 'adjustedClose': 89.12345678}]
            api.write_json(root / 'TEST.json', {'asOf': api.last_closed_day(), 'rows': rows, 'data': {'date': rows[-1]['date'], 'observationCount': 2}})
            with patch.object(api, 'CACHE', root), patch.object(api, 'paced_fetch') as fetch:
                result = api.refresh('TEST')
                fetch.assert_not_called()
                self.assertIn('10', result['windows'])
                self.assertIn('all', result['windows'])
                self.assertEqual(api.read_json(root / 'TEST.json')['rows'], rows)

    def test_stale_cache_returns_without_waiting_for_upstream(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            api.PENDING.clear()
            api.FAILURES.clear()
            data = {'symbol': 'TEST'}
            api.write_json(root / 'TEST.json', {'version': api.CALCULATION_VERSION, 'asOf': '2000-01-01', 'data': data})
            pending = Future()
            try:
                with patch.object(api, 'CACHE', root), patch.object(api, 'SNAPSHOT', root / 'missing'), patch.object(api.POOL, 'submit', return_value=pending) as submit:
                    self.assertEqual(api.instrument('TEST'), data)
                    self.assertEqual(api.instrument('TEST'), data)
                    submit.assert_called_once()
            finally:
                api.PENDING.clear()

    def test_rate_limit_pauses_new_upstream_requests(self):
        api.BACKOFF_UNTIL = 0
        api.NEXT_REQUEST = 0
        try:
            error = HTTPError('https://example.test', 429, 'Too many requests', {}, None)
            with patch.object(api, 'fetch_etf', side_effect=error) as fetch:
                with self.assertRaises(HTTPError):
                    api.paced_fetch('TEST')
                with self.assertRaisesRegex(RuntimeError, 'upstream_backoff'):
                    api.paced_fetch('OTHER')
                self.assertEqual(fetch.call_count, 1)
        finally:
            api.BACKOFF_UNTIL = 0
            api.NEXT_REQUEST = 0


if __name__ == '__main__':
    unittest.main()
