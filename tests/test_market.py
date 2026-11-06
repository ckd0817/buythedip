import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from update_data import build_etf, ETF_VOLATILITY


class MarketHistoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        days = [date(2020, 1, 1) + timedelta(days=i) for i in range(2500)]
        days = [d.isoformat() for d in days if d.weekday() < 5]
        cls.rows = [{'date': d, 'close': 100 + i / 10, 'adjustedClose': 80 + i / 10} for i, d in enumerate(days)]
        cls.vols = {
            symbol: [{'date': d, 'value': 10 + offset * 5 + i % 7}
                     for i, d in enumerate(days) if symbol != 'VXSMH' or d >= '2025-09-16']
            for offset, symbol in enumerate(dict.fromkeys(ETF_VOLATILITY.values()))
        }

    def test_etf_uses_corresponding_volatility_history(self):
        for symbol, vol in ETF_VOLATILITY.items():
            with self.subTest(symbol=symbol):
                result = build_etf(symbol, self.rows, self.vols)
                window = result['windows']['3']
                self.assertEqual(result['volatilitySymbol'], vol)
                self.assertEqual(window['chart'][-1]['volatility'], window['volatility'][vol]['value'])
                self.assertAlmostEqual(window['chart'][-1]['rsi'], window['rsi']['value'], places=3)
                self.assertAlmostEqual(window['chart'][-1]['ma'], window['ma']['value'], places=4)

    def test_short_vxsmh_history_is_not_backfilled_or_ranked(self):
        result = build_etf('SMH', self.rows, self.vols)
        for name, window in result['windows'].items():
            if name == 'all':
                continue
            self.assertIsNone(window['volatility']['VXSMH']['percentile'])
            self.assertEqual(window['volatility']['VXSMH']['historyStart'], '2025-09-16')
            before = [p for p in window['chart'] if p['date'] < '2025-09-16']
            self.assertTrue(before)
            self.assertTrue(all(p['volatility'] is None for p in before))

    def test_oversold_percentiles_are_reversed_without_changing_raw_values(self):
        window = build_etf('SPY', self.rows, self.vols)['windows']['3']
        # Strictly rising prices have RSI=100, which is not historically oversold.
        self.assertEqual(window['rsi']['value'], 100)
        self.assertEqual(window['rsi']['percentile'], 0)
        # Constant absolute gains make the percentage MA deviation steadily decline.
        self.assertGreater(window['ma']['value'], 0)
        self.assertEqual(window['ma']['percentile'], 100)

    def test_missing_date_remains_gap(self):
        vols = {**self.vols, 'VIX': self.vols['VIX'][:-1]}
        result = build_etf('SPY', self.rows, vols)
        self.assertIsNone(result['windows']['3']['chart'][-1]['volatility'])


if __name__ == '__main__':
    unittest.main()
