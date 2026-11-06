"""Daily open-end fund NAVs; parse JSON values without executing provider JS."""
import json
import math
import re
from datetime import datetime, timezone
from instruments import last_closed_day, market_timezone


def parse_fund_history(symbol, script):
    code = symbol[:6]

    def variable(name):
        match = re.search(r'\bvar\s+' + re.escape(name) + r'\s*=\s*', script)
        if not match:
            raise ValueError('unsupported_fund')
        return json.JSONDecoder().raw_decode(script[match.end():])[0]

    if variable('fS_code') != code:
        raise ValueError('fund_identity_mismatch')
    name = variable('fS_name')
    if not isinstance(name, str) or not name:
        raise ValueError('fund_identity_mismatch')
    if any(unit in name for unit in ('美元', '港币', '港元', '欧元', '英镑', '日元')):
        # This adapter currently supports RMB-denominated NAV share classes.
        raise ValueError('unsupported_fund')
    if variable('ishb') in (True, 1, 'true', '1'):
        # Money-market income/yield is not a price or NAV return series.
        raise ValueError('unsupported_fund')
    history = variable('Data_netWorthTrend')
    if not isinstance(history, list):
        raise ValueError('invalid_fund_history')
    rows = []
    cutoff = last_closed_day(symbol)
    adjusted, scale = None, 1.0
    for item in history:
        day = datetime.fromtimestamp(float(item['x']) / 1000, timezone.utc).astimezone(market_timezone(symbol)).date().isoformat()
        if day > cutoff:
            continue
        nav = float(item['y'])
        if not math.isfinite(nav) or nav <= 0 or (rows and day <= rows[-1]['date']):
            raise ValueError('invalid_fund_history')
        if adjusted is not None and item.get('unitMoney'):
            # Provider daily NAV growth on distribution/conversion dates
            # incorporates that action; raw NAV ratios would create false dips.
            change = float(item['equityReturn']) / 100
            if not math.isfinite(change) or change <= -1:
                raise ValueError('invalid_fund_adjustment')
            scale = adjusted * (1 + change) / nav
        adjusted = nav * scale
        if not math.isfinite(adjusted) or adjusted <= 0:
            raise ValueError('invalid_fund_adjustment')
        rows.append({'date': day, 'close': nav, 'adjustedClose': adjusted})
    if not rows:
        raise ValueError('no_history')
    rows[0]['fundName'] = name
    return rows


def fetch_fund(symbol, download):
    if not re.fullmatch(r'\d{6}\.OF', symbol):
        raise ValueError('invalid_symbol')
    script = download(f'https://fund.eastmoney.com/pingzhongdata/{symbol[:6]}.js',
                      {'Referer': 'https://fund.eastmoney.com/'}).decode('utf-8-sig')
    return symbol, parse_fund_history(symbol, script)
