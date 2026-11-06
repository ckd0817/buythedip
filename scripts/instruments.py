"""Curated index identities and exchange-local daily-close boundaries."""
from datetime import datetime, timedelta, timezone
import re
from zoneinfo import ZoneInfo

INDEXES = {
    'SPX': {'name': 'S&P 500', 'source': 'yahoo', 'ticker': '^GSPC', 'market': 'US', 'currency': 'USD', 'minimumYears': 50},
    'NDX': {'name': 'Nasdaq-100', 'source': 'yahoo', 'ticker': '^NDX', 'market': 'US', 'currency': 'USD', 'minimumYears': 30},
    'CSI300': {'name': 'CSI 300', 'source': 'eastmoney', 'ticker': '1.000300', 'tencent': 'sh000300', 'startYear': 2005, 'market': 'CN', 'currency': 'CNY', 'minimumYears': 15},
    'STAR50': {'name': 'STAR 50', 'source': 'eastmoney', 'ticker': '1.000688', 'tencent': 'sh000688', 'startYear': 2019, 'market': 'CN', 'currency': 'CNY', 'minimumYears': 5},
    'HSTECH': {'name': 'Hang Seng TECH', 'source': 'tencent', 'tencent': 'hkHSTECH', 'startYear': 2020, 'market': 'HK', 'currency': 'HKD', 'minimumYears': 5},
    'N225': {'name': 'Nikkei 225', 'source': 'yahoo', 'ticker': '^N225', 'market': 'JP', 'currency': 'JPY', 'minimumYears': 40},
}
MARKETS = {
    'US': ('America/New_York', (16, 30)),
    'CN': ('Asia/Shanghai', (15, 30)),
    'HK': ('Asia/Hong_Kong', (16, 30)),
    'JP': ('Asia/Tokyo', (16, 0)),
}
ALIASES = {
    '^GSPC': 'SPX', 'GSPC': 'SPX', 'S&P500': 'SPX', '标普500': 'SPX', '標普500': 'SPX',
    '^NDX': 'NDX', 'NASDAQ100': 'NDX', '纳指100': 'NDX', '纳斯达克100': 'NDX', '納指100': 'NDX',
    '沪深300': 'CSI300', '滬深300': 'CSI300', '000300': 'CSI300', '000300.SS': 'CSI300', '000300.SH': 'CSI300', 'SH000300': 'CSI300', '399300.SZ': 'CSI300',
    '科创50': 'STAR50', '科創50': 'STAR50', '000688': 'STAR50', '000688.SS': 'STAR50', '000688.SH': 'STAR50', 'SH000688': 'STAR50',
    '恒生科技': 'HSTECH', '恆生科技': 'HSTECH', 'HSTECH.HK': 'HSTECH',
    '日经225': 'N225', '日经指数': 'N225', '日經225': 'N225', '日经': 'N225', '^N225': 'N225', 'NIKKEI225': 'N225',
}


def normalize_symbol(value):
    symbol = ''.join(value.strip().upper().split())
    fund = re.fullmatch(r'(?:(?:基金|FUND)(\d{6})|(\d{6})\.OF)', symbol)
    if fund:
        return f'{fund[1] or fund[2]}.OF'
    if symbol in INDEXES:
        return symbol
    if symbol in ALIASES:
        return ALIASES[symbol]
    cn = re.fullmatch(r'(?:(SH|SZ))?(\d{6})(?:\.(SS|SH|SZ))?', symbol)
    if cn:
        prefix, code, suffix = cn.groups()
        exchange = prefix or suffix
        if not exchange and code[0] in '478':
            return f'{code}.OF'
        suffix = ('SZ' if exchange == 'SZ' else 'SS') if exchange else ('SS' if code[0] in '569' else 'SZ')
        if code[0] not in ('569' if suffix == 'SS' else '0123'):
            raise ValueError('invalid_symbol')
        return f'{code}.{suffix}'
    hk = re.fullmatch(r'(?:HK(\d{1,5})|(\d{1,5})(?:\.HK)?)', symbol)
    if hk:
        code = int(hk[1] or hk[2])
        if code == 0:
            raise ValueError('invalid_symbol')
        return f'{code:04d}.HK'
    symbol = symbol.replace('.', '-')
    if not re.fullmatch(r'[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)?', symbol) or len(symbol) > 15:
        raise ValueError('invalid_symbol')
    return symbol


def market_of(symbol=None):
    if symbol and re.fullmatch(r'\d{6}\.(SS|SZ|OF)', symbol):
        return 'CN'
    if symbol and re.fullmatch(r'\d{4,5}\.HK', symbol):
        return 'HK'
    return INDEXES.get(symbol, {}).get('market', 'US')


def market_timezone(symbol=None):
    return ZoneInfo(MARKETS[market_of(symbol)][0])


def last_closed_day(symbol=None, now=None):
    local = (now or datetime.now(timezone.utc)).astimezone(market_timezone(symbol))
    close = MARKETS[market_of(symbol)][1]
    day = local.date() if (local.hour, local.minute) >= close else local.date() - timedelta(days=1)
    while day.weekday() >= 5:
        day -= timedelta(days=1)
    # Holidays come from actual provider bars: this is an update/cache boundary,
    # never a promise that a trading bar exists on every weekday.
    return day.isoformat()


def metadata(symbol):
    config = INDEXES.get(symbol)
    fund = bool(re.fullmatch(r'\d{6}\.OF', symbol))
    return {
        'kind': 'index' if config else 'fund' if fund else 'security',
        'name': config['name'] if config else symbol,
        'market': market_of(symbol),
        'currency': config['currency'] if config else {'US': 'USD', 'CN': 'CNY', 'HK': 'HKD'}[market_of(symbol)],
        'timezone': str(market_timezone(symbol)),
        'priceBasis': 'indexClose' if config else 'reinvestedNav' if fund else 'adjustedClose',
    }
