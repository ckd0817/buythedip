import json
import sys
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import api
from funds import parse_fund_history
from instruments import normalize_symbol, metadata
from update_data import build_etf


def script(history, code='110022', money=False):
    return '\n'.join(f'var {key}={json.dumps(value)};' for key, value in {
        'fS_code': code, 'fS_name': '测试基金A', 'ishb': money, 'Data_netWorthTrend': history,
    }.items())


def nav(day, value, change=0, action=''):
    return {'x': int(datetime(2020, 1, day, tzinfo=timezone.utc).timestamp()) * 1000,
            'y': value, 'equityReturn': change, 'unitMoney': action}


class FundTests(unittest.TestCase):
    def test_explicit_fund_and_stock_codes(self):
        for value in ('基金000001', 'FUND000001', '000001.OF'):
            self.assertEqual(normalize_symbol(value), '000001.OF')
        self.assertEqual(normalize_symbol('000001'), '000001.SZ')
        self.assertEqual(metadata('110022.OF')['kind'], 'fund')

    def test_ambiguous_search_returns_both_without_choosing(self):
        values = {
            '000001.SZ': {'symbol': '000001.SZ', 'kind': 'security', 'name': '平安银行'},
            '000001.OF': {'symbol': '000001.OF', 'kind': 'fund', 'name': '华夏成长混合'},
        }
        with patch('api.instrument', side_effect=lambda symbol: values[symbol]):
            result = api.search_candidates('000001')
        self.assertEqual([x['symbol'] for x in result], ['000001.SZ', '000001.OF'])
        self.assertEqual([x['name'] for x in result], ['平安银行', '华夏成长混合'])
        with self.assertRaisesRegex(ValueError, 'invalid_symbol'):
            api.search_candidates('SPY')

    def test_single_match_and_provider_failures_are_distinguished(self):
        stock = {'symbol': '000001.SZ', 'kind': 'security', 'name': '平安银行'}
        fund = {'symbol': '000001.OF', 'kind': 'fund', 'name': '华夏成长混合'}
        for available in (stock, fund):
            def lookup(symbol):
                if symbol == available['symbol']:
                    return available
                raise HTTPError('x', 404, 'missing', None, None)
            with patch('api.instrument', side_effect=lookup):
                self.assertEqual(api.search_candidates('000001'), [available])
        for status in (429, 503):
            def lookup(symbol):
                if symbol.endswith('.OF'):
                    return fund
                raise HTTPError('x', status, 'unavailable', None, None)
            with patch('api.instrument', side_effect=lookup):
                with self.assertRaises(HTTPError):
                    api.search_candidates('000001')

    def test_distributions_and_splits_do_not_create_false_drawdowns(self):
        history = [nav(1, 1), nav(2, .8, 0, '分红'), nav(3, .88, 10), nav(4, .44, 0, '拆分'), nav(5, .44, 0)]
        rows = parse_fund_history('110022.OF', script(history))
        self.assertEqual([round(r['adjustedClose'], 8) for r in rows], [1, 1, 1.1, 1.1, 1.1])
        self.assertEqual(rows[-1]['close'], .44)
        data = build_etf('110022.OF', rows, {})
        self.assertEqual((data['kind'], data['currency']), ('fund', 'CNY'))
        self.assertEqual(data['drawdown'], 0)
        self.assertIsNone(data['volatilitySymbol'])

    def test_identity_money_market_and_unfinished_or_invalid_rows(self):
        with self.assertRaisesRegex(ValueError, 'identity'):
            parse_fund_history('110022.OF', script([nav(1, 1)], code='000001'))
        with self.assertRaisesRegex(ValueError, 'unsupported_fund'):
            parse_fund_history('110022.OF', script([], money=True))
        for history in ([nav(1, 1), nav(1, 1)], [nav(1, 0)], [nav(1, 1), nav(2, .5, -100, '拆分')]):
            with self.assertRaises(ValueError):
                parse_fund_history('110022.OF', script(history))
        with patch('funds.last_closed_day', return_value='2020-01-01'):
            self.assertEqual(len(parse_fund_history('110022.OF', script([nav(1, 1), nav(2, .9)]))), 1)

    def test_delayed_nav_is_retried_after_fifteen_minutes(self):
        item = {'version': api.CALCULATION_VERSION, 'created': time.time(), 'data': {'date': '2020-01-01'}}
        self.assertTrue(api.fresh(item, '110022.OF'))
        item['created'] -= 901
        self.assertFalse(api.fresh(item, '110022.OF'))
