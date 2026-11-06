from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from instruments import last_closed_day, normalize_symbol
from instruments import INDEXES
from update_data import build_etf, fetch_etf, fetch_index, main


class MultiMarketTests(unittest.TestCase):
    def test_index_aliases_and_us_share_classes_remain_distinct(self):
        for text, result in [('沪深300', 'CSI300'), ('000300.SS', 'CSI300'), ('000688.SH', 'STAR50'), ('恒生科技', 'HSTECH'), ('^N225', 'N225'), ('^GSPC', 'SPX'), ('^NDX', 'NDX'), ('brk.b', 'BRK-B'), ('SPY', 'SPY'), ('QQQ', 'QQQ')]:
            self.assertEqual(normalize_symbol(text), result)

    def test_exchange_close_boundaries(self):
        now = datetime(2026, 11, 4, 7, 0, tzinfo=timezone.utc)
        self.assertEqual(last_closed_day('CSI300', now), '2026-11-03')
        self.assertEqual(last_closed_day('HSTECH', now), '2026-11-03')
        self.assertEqual(last_closed_day('N225', now), '2026-11-04')
        self.assertEqual(last_closed_day('SPX', now), '2026-11-03')
        now = now.replace(minute=31)
        self.assertEqual(last_closed_day('CSI300', now), '2026-11-04')
        self.assertEqual(last_closed_day('HSTECH', now), '2026-11-03')
        self.assertEqual(last_closed_day('AAPL', datetime(2026, 11, 8, 20, tzinfo=timezone.utc)), '2026-11-06')

    def test_indices_use_closing_levels_and_securities_use_adjusted_prices(self):
        rows = [{'date': '2020-01-02', 'close': 100, 'adjustedClose': 100}, {'date': '2026-11-03', 'close': 90, 'adjustedClose': 120}]
        index = build_etf('SPX', rows, {})
        stock = build_etf('AAPL', rows, {})
        self.assertAlmostEqual(index['drawdown'], -10)
        self.assertEqual(index['windows']['all']['chart'][-1]['price'], 90)
        self.assertEqual(index['priceBasis'], 'indexClose')
        self.assertEqual(stock['drawdown'], 0)
        self.assertEqual(stock['windows']['all']['chart'][-1]['price'], 120)

    def test_japanese_dates_and_open_session_bar_exclusion(self):
        data = {'chart': {'error': None, 'result': [{
            'meta': {'dataGranularity': '1d', 'instrumentType': 'INDEX'},
            'timestamp': [int(datetime(1965, 1, 5, 0, tzinfo=timezone.utc).timestamp()), int(datetime(2026, 11, 2, 0, tzinfo=timezone.utc).timestamp()), int(datetime(2026, 11, 4, 0, tzinfo=timezone.utc).timestamp())],
            'indicators': {'quote': [{'close': [1000, 60000, 61000]}], 'adjclose': [{'adjclose': [1, 2, 3]}]},
        }]}}
        with patch('update_data.download', return_value=json.dumps(data).encode()), patch('update_data.last_closed_day', return_value='2026-11-03'):
            _, rows = fetch_etf('N225', save_raw=False)
        self.assertEqual([r['date'] for r in rows], ['1965-01-05', '2026-11-02'])
        self.assertEqual(rows[-1]['adjustedClose'], 60000)

    def test_wrong_index_identity_and_truncated_backup_are_rejected(self):
        bad = json.dumps({'data': {'name': '另一指数', 'klines': ['2026-11-03,1,2,3,1,0,0,0']}}).encode()
        clipped = json.dumps({'code': 0, 'data': {'sh000300': {'day': [['2005-01-04', '1', '1']] * 640}}}).encode()
        with patch('update_data.download', side_effect=[bad, clipped]), patch('update_data.last_closed_day', return_value='2026-11-03'):
            with self.assertRaisesRegex(ValueError, 'clipped'):
                fetch_index('CSI300')

    def test_index_source_never_creates_holiday_or_intraday_rows(self):
        packet = {'data': {'name': '科创50', 'klines': ['2019-12-31,1000,1000,1000,1000,0,0,0', '2026-11-02,1100,1150,1200,1090,0,0,0', '2026-11-04,1100,1190,1200,1090,0,0,0']}}
        with patch('update_data.download', return_value=json.dumps(packet).encode()), patch('update_data.last_closed_day', return_value='2026-11-03'):
            _, rows = fetch_index('STAR50')
        self.assertEqual(rows[-1]['date'], '2026-11-02')
        self.assertEqual(len(rows), 2)

    def test_tencent_backward_response_is_trimmed_without_losing_slice(self):
        end = datetime(2024, 8, 1)
        bars = [[(end - timedelta(days=i)).date().isoformat(), '100', '101'] for i in range(639, -1, -1)]
        packet = {'code': 0, 'data': {'hkHSTECH': {'day': bars}}}
        config = {**INDEXES['HSTECH'], 'startYear': 2023, 'minimumYears': 0}
        with patch.dict(INDEXES, {'HSTECH': config}), patch('update_data.download', return_value=json.dumps(packet).encode()), patch('update_data.last_closed_day', return_value='2024-08-01'):
            _, rows = fetch_index('HSTECH')
        self.assertEqual(rows[0]['date'], '2023-01-01')
        self.assertEqual(rows[-1]['date'], '2024-08-01')
        self.assertEqual(len(rows), len({row['date'] for row in rows}))

    def test_regional_refresh_preserves_other_markets_and_failed_index(self):
        rows = [{'date': '2019-12-31', 'close': 1000, 'adjustedClose': 1000}, {'date': '2026-11-03', 'close': 1100, 'adjustedClose': 1100}]
        old = {s: build_etf(s, rows, {}) for s in ('SPX', 'CSI300')}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / 'public/data/market.json'
            target.parent.mkdir(parents=True)
            target.write_text(json.dumps({'etfs': old}))
            def fetch(symbol):
                if symbol == 'CSI300':
                    raise RuntimeError('provider unavailable')
                return symbol, rows
            with patch('update_data.DEFAULT_SYMBOLS', ('SPX', 'CSI300', 'STAR50')), patch('update_data.ROOT', root), patch('update_data.fetch_etf', side_effect=fetch) as source, patch.dict(os.environ, {}, clear=True):
                main('CN')
            result = json.loads(target.read_text())['etfs']
            self.assertEqual(result['SPX'], old['SPX'])
            self.assertEqual(result['CSI300'], old['CSI300'])
            self.assertIn('STAR50', result)
            self.assertEqual({call.args[0] for call in source.call_args_list}, {'CSI300', 'STAR50'})


if __name__ == '__main__':
    unittest.main()
