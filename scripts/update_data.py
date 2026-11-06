"""Fetch real daily closes; atomically publish only complete, validated snapshots."""
import argparse
import csv
import io
import json
import math
import os
from pathlib import Path
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from urllib.parse import quote, urlencode
from instruments import INDEXES, market_of, market_timezone, last_closed_day, metadata
try:
    from zoneinfo import ZoneInfo
    NY = ZoneInfo('America/New_York')
except Exception:
    raise SystemExit('Timezone database missing. On Windows run: python -m pip install tzdata')
from metrics import drawdowns, drawdown_event_percentiles, drawdown_event_quantiles, ma_deviation, rolling_percentiles, rsi, years_before

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SYMBOLS = ('SPY', 'QQQ', 'SMH')
LOOKBACKS = (3, 5, 10, None)
CALCULATION_VERSION = 6
ETF_VOLATILITY = {
    'SPX': 'VIX', 'NDX': 'VXN', 'SPY': 'VIX', 'QQQ': 'VXN', 'SMH': 'VXSMH', 'IWM': 'RVX', 'DIA': 'VXD',
    'AAPL': 'VXAPL', 'AMZN': 'VXAZN', 'GOOG': 'VXGOG', 'GS': 'VXGS', 'IBM': 'VXIBM',
    'GLD': 'GVZ', 'USO': 'OVX', 'EEM': 'VXEEM', 'EFA': 'VXEFA', 'EWZ': 'VXEWZ',
    'FXI': 'VXFXI', 'GDX': 'VXGDX', 'SLV': 'VXSLV', 'TLT': 'VXTLT',
    'HYG': 'VXHYG', 'LQD': 'VXLQD', 'IEF': 'VXIEF',
}
def download(url, headers=None, timeout=35, attempts=3):
    for attempt in range(attempts):
        try:
            with urlopen(Request(url, headers={'User-Agent': 'Mozilla/5.0', **(headers or {})}), timeout=timeout) as response:
                return response.read()
        except Exception as error:
            if isinstance(error, HTTPError) and 400 <= error.code < 500 and error.code != 408:
                raise
            if attempt == attempts - 1:
                raise
            time.sleep(attempt + 1)


def fetch_etf(symbol, require_full_history=True, validate_us=False, save_raw=True):
    if symbol.endswith('.OF'):
        from funds import fetch_fund
        return fetch_fund(symbol, download)
    config = INDEXES.get(symbol)
    if config and config['source'] != 'yahoo':
        return fetch_index(symbol, save_raw=save_raw)
    ticker = config['ticker'] if config else symbol
    # Explicit daily timestamps include pre-1970 history for long-lived indices.
    url = f'https://query1.finance.yahoo.com/v8/finance/chart/{quote(ticker, safe="")}?period1=-2208988800&period2={int(time.time())}&interval=1d&events=div%2Csplits'
    raw = download(url)
    payload = json.loads(raw)
    if payload.get('chart', {}).get('error'):
        raise ValueError(f'{symbol}: upstream error')
    data = payload['chart']['result'][0]
    if data['meta'].get('dataGranularity') != '1d':
        raise ValueError(f'{symbol}: provider did not return daily bars')
    meta = data['meta']
    if config and meta.get('instrumentType') != 'INDEX':
        raise ValueError(f'{symbol}: expected an index')
    if validate_us and not config:
        expected = metadata(symbol)
        if (meta.get('instrumentType') not in ('ETF', 'EQUITY') or meta.get('currency') != expected['currency']
                or meta.get('exchangeTimezoneName') != expected['timezone']
                or meta.get('symbol', symbol).upper() != symbol):
            raise ValueError('unsupported_instrument')
    cutoff = last_closed_day(symbol)
    close_values = data['indicators']['quote'][0]['close']
    adjusted = close_values if config else data['indicators']['adjclose'][0]['adjclose']
    rows = []
    for stamp, close, adj in zip(data['timestamp'], close_values, adjusted):
        day = (datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(seconds=stamp)).astimezone(market_timezone(symbol)).date().isoformat()
        if day > cutoff or close is None or adj is None:
            continue
        if not all(math.isfinite(v) and v > 0 for v in (close, adj)):
            raise ValueError(f'{symbol}: invalid price on {day}')
        rows.append({'date': day, 'close': close, 'adjustedClose': adj})
    if not rows:
        raise ValueError('no_history')
    rows[0]['securityName'] = meta.get('longName') or meta.get('shortName') or symbol
    if config and rows[0]['date'] > years_before(rows[-1]['date'], config['minimumYears']):
        raise ValueError(f'{symbol}: truncated index history')
    if require_full_history and not config and (len(rows) < 3000 or rows[0]['date'] > years_before(rows[-1]['date'], 10)):
        raise ValueError(f'{symbol}: insufficient history')
    if len({r['date'] for r in rows}) != len(rows) or rows != sorted(rows, key=lambda r: r['date']):
        raise ValueError(f'{symbol}: unordered or duplicate bars')
    if save_raw:
        raw_dir = ROOT / 'data/raw'
        raw_dir.mkdir(parents=True, exist_ok=True)
        (raw_dir / f'{symbol}.json').write_bytes(raw)
    return symbol, rows


def fetch_index(symbol, save_raw=False):
    config = INDEXES[symbol]
    cutoff = last_closed_day(symbol)
    values = []
    if config['source'] == 'eastmoney':
        try:
            params = {'secid': config['ticker'], 'klt': '101', 'fqt': '0', 'beg': '19900101',
                      'end': cutoff.replace('-', ''), 'lmt': '20000',
                      'fields1': 'f1,f2,f3,f4,f5', 'fields2': 'f51,f52,f53,f54,f55,f56,f57,f58'}
            payload = json.loads(download('https://push2his.eastmoney.com/api/qt/stock/kline/get?' + urlencode(params), {'Referer': 'https://quote.eastmoney.com/'}, timeout=12, attempts=1))
            data = payload.get('data') or {}
            expected = {'CSI300': '沪深300', 'STAR50': '科创50'}[symbol]
            if data.get('name') != expected or not data.get('klines'):
                raise ValueError('Index identity/history mismatch')
            values = [(row.split(',')[0], float(row.split(',')[2])) for row in data['klines']]
        except Exception as error:
            print(f'{symbol}: Eastmoney unavailable, trying Tencent ({type(error).__name__})', file=sys.stderr)
    if not values:
        # Tencent caps a response at 640 rows. Disjoint two-calendar-year
        # requests stay below the cap and preserve all available daily history.
        for year in range(config['startYear'], int(cutoff[:4]) + 1, 2):
            start, end = f'{year}-01-01', min(f'{year + 1}-12-31', cutoff)
            params = {'param': f"{config['tencent']},day,{start},{end},640,qfq"}
            payload = json.loads(download('https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get?' + urlencode(params), {'Referer': 'https://gu.qq.com/'}, timeout=15, attempts=2))
            if payload.get('code') != 0:
                raise ValueError(f'{symbol}: Tencent error')
            data = payload.get('data', {}).get(config['tencent'], {})
            bars = data.get('day') or data.get('qfqday') or []
            # Some Tencent series ignore start and return up to 640 bars
            # backwards from end. Accept that only when the returned range
            # fully covers our two-year slice, then trim the overlap.
            if any(row[0] > end for row in bars) or (len(bars) >= 640 and bars[0][0] > start):
                raise ValueError(f'{symbol}: clipped or out-of-range index history')
            values.extend((row[0], float(row[2])) for row in bars if start <= row[0] <= end)
    rows = []
    for day, value in sorted(values):
        datetime.strptime(day, '%Y-%m-%d')
        if day > cutoff:
            continue
        if not math.isfinite(value) or value <= 0:
            raise ValueError(f'{symbol}: invalid index value')
        rows.append({'date': day, 'close': value, 'adjustedClose': value})
    if not rows or len({row['date'] for row in rows}) != len(rows):
        raise ValueError(f'{symbol}: missing/duplicate history')
    if rows[0]['date'] > years_before(rows[-1]['date'], config['minimumYears']):
        raise ValueError(f'{symbol}: truncated index history')
    if save_raw:
        raw_dir = ROOT / 'data/raw'
        raw_dir.mkdir(parents=True, exist_ok=True)
        (raw_dir / f'{symbol}.rows.json').write_text(json.dumps(rows, allow_nan=False), encoding='utf-8')
    return symbol, rows


def fetch_vol(symbol, require_full_history=True):
    raw = download(f'https://cdn.cboe.com/api/global/us_indices/daily_prices/{symbol}_History.csv')
    rows = []
    cutoff = last_closed_day()
    for row in csv.DictReader(io.StringIO(raw.decode('utf-8-sig'))):
        day = datetime.strptime(row['DATE'].strip(), '%m/%d/%Y').date().isoformat()
        value = float(row.get('CLOSE', row.get(symbol, 'nan')))
        if day <= cutoff and math.isfinite(value) and value > 0:
            rows.append({'date': day, 'value': value})
    rows.sort(key=lambda r: r['date'])
    minimum = (200 if symbol == 'VXSMH' else 2500) if require_full_history else 1
    if len(rows) < minimum or len({r['date'] for r in rows}) != len(rows):
        raise ValueError(f'{symbol}: invalid volatility history')
    return symbol, rows


def build_etf(symbol, rows, volatility):
    dates = [r['date'] for r in rows]
    prices = [r['close'] if symbol in INDEXES else r['adjustedClose'] for r in rows]
    dd = drawdowns(prices)
    strength = rsi(prices)
    deviation = ma_deviation(prices)
    volatility_symbol = ETF_VOLATILITY.get(symbol)
    volatility_by_date = {r['date']: r['value'] for r in volatility.get(volatility_symbol, []) if r['date'] <= dates[-1]}
    if not volatility_by_date or (datetime.fromisoformat(dates[-1]) - datetime.fromisoformat(max(volatility_by_date))).days > 4:
        volatility_symbol = None
        volatility_by_date = {}
    windows = {}
    for years in LOOKBACKS:
        indices, event_counts = drawdown_event_percentiles(dates, dd, years)
        rsi_rank = rolling_percentiles(dates, strength, years, reverse=True)
        ma_rank = rolling_percentiles(dates, deviation, years, reverse=True)
        vols = {}
        for name, history in volatility.items():
            available = [r for r in history if r['date'] <= dates[-1]]
            if not available:
                continue
            rank = rolling_percentiles([r['date'] for r in available], [r['value'] for r in available], years)
            latest = available[-1]
            # Never present a much older volatility close as current.
            stale = (datetime.fromisoformat(dates[-1]) - datetime.fromisoformat(latest['date'])).days > 4
            vols[name] = {'value': None if stale else latest['value'], 'percentile': None if stale else rank[-1], 'date': latest['date'], 'historyStart': available[0]['date']}
        cutoff = dates[0] if years is None else years_before(dates[-1], years)
        chart = [{
            'date': d, 'price': round(prices[i], 4), 'drawdown': round(-dd[i] * 100, 5),
            'index': None if indices[i] is None else round(indices[i], 3),
            'rsi': None if strength[i] is None else round(strength[i], 4),
            'ma': None if deviation[i] is None else round(deviation[i] * 100, 5),
            'volatility': volatility_by_date.get(d),
        } for i, d in enumerate(dates) if d >= cutoff]
        windows['all' if years is None else str(years)] = {
            'index': indices[-1],
            'rsi': {'value': strength[-1], 'percentile': rsi_rank[-1], 'date': dates[-1]},
            'ma': {'value': None if deviation[-1] is None else deviation[-1] * 100, 'percentile': ma_rank[-1], 'date': dates[-1]},
            'volatility': vols,
            'drawdownSampleCount': event_counts[-1],
            'drawdownEventCount': event_counts[-1],
            'chart': chart,
        }
    return {**metadata(symbol), 'name': rows[0].get('fundName') or rows[0].get('securityName') or metadata(symbol)['name'], 'calculationVersion': CALCULATION_VERSION, 'drawdownQuantiles': drawdown_event_quantiles(dd), 'updatedThrough': last_closed_day(symbol), 'symbol': symbol, 'volatilitySymbol': volatility_symbol, 'date': dates[-1], 'close': rows[-1]['close'], 'drawdown': -dd[-1] * 100, 'historyStart': dates[0], 'observationCount': len(rows), 'windows': windows}


def main(market='all'):
    target = ROOT / 'public/data/market.json'
    previous = json.loads(target.read_text(encoding='utf-8')) if target.exists() else {}
    etfs = {s: item for s, item in previous.get('etfs', {}).items() if s in DEFAULT_SYMBOLS}
    selected = [s for s in DEFAULT_SYMBOLS if market == 'all' or market_of(s) == market]
    histories, volatility, errors = {}, {}, []
    with ThreadPoolExecutor(max_workers=3) as pool:
        price_futures = {s: pool.submit(fetch_etf, s) for s in selected}
        vol_futures = {v: pool.submit(fetch_vol, v) for v in {ETF_VOLATILITY[s] for s in selected if s in ETF_VOLATILITY}}
        for symbol, future in price_futures.items():
            try:
                _, histories[symbol] = future.result()
            except Exception as error:
                errors.append(f'{symbol}: {error}')
        for symbol, future in vol_futures.items():
            try:
                _, volatility[symbol] = future.result()
            except Exception as error:
                errors.append(f'{symbol}: {error}')
    updated = []
    for symbol, rows in histories.items():
        try:
            required_vol = ETF_VOLATILITY.get(symbol)
            if required_vol and required_vol not in volatility and symbol in etfs:
                raise ValueError('volatility unavailable; retaining previous complete snapshot')
            item = build_etf(symbol, rows, {required_vol: volatility[required_vol]} if required_vol in volatility else {})
            old = etfs.get(symbol)
            if old and (item['date'] < old['date'] or item['observationCount'] < old['observationCount'] - 5):
                raise ValueError('upstream history regressed')
            etfs[symbol] = item
            updated.append(symbol)
        except Exception as error:
            errors.append(f'{symbol}: {error}')
    if not updated:
        raise ValueError('; '.join(errors) or 'No instruments selected')
    result = {
        'schemaVersion': 2,
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'sources': {'etf': 'Yahoo Finance', 'volatility': 'Cboe', 'indices': 'Yahoo Finance / Eastmoney / Tencent'},
        'etfs': etfs,
    }
    encoded = json.dumps(result, ensure_ascii=False, allow_nan=False, separators=(',', ':'))
    directories = [target.parent]
    if os.environ.get('MARKET_PUBLISH_DIR'):
        directories.append(Path(os.environ['MARKET_PUBLISH_DIR']).resolve())
    targets = {}
    for directory in directories:
        targets[directory / 'market.json'] = encoded
        for symbol, item in result['etfs'].items():
            targets[directory / f'{symbol}.json'] = json.dumps(item, ensure_ascii=False, allow_nan=False, separators=(',', ':'))
    for destination, body in targets.items():
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix('.tmp')
        temporary.write_text(body, encoding='utf-8')
        for attempt in range(6):
            try:
                os.replace(temporary, destination)
                break
            except PermissionError:
                if attempt == 5:
                    raise
                # Windows file watchers or a simultaneous read can briefly lock the target.
                time.sleep(.2 * (attempt + 1))
    for error in errors:
        print('Retained previous data: ' + error, file=sys.stderr)
    for symbol in updated:
        item = result['etfs'][symbol]
        score = item['windows']['5']['index']
        print(f'{symbol}: {item["date"]} | {item["observationCount"]} daily observations | 5Y index {score if score is not None else 'insufficient'}')
    print(f'Snapshot: {target}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--market', choices=['all', 'US', 'CN', 'HK', 'JP'], default='all')
    args = parser.parse_args()
    try:
        # Regional timers and manual refreshes share one lock across releases.
        lock_dir = Path(os.environ.get('MARKET_PUBLISH_DIR', str(ROOT / 'public/data')))
        lock_dir.mkdir(parents=True, exist_ok=True)
        with (lock_dir / '.update.lock').open('a') as lock:
            if os.name == 'posix':
                import fcntl
                fcntl.flock(lock, fcntl.LOCK_EX)
            main(args.market)
    except Exception as error:
        print(f'Update failed; previous snapshot retained: {error}', file=sys.stderr)
        sys.exit(1)
