"""Loopback-only US/CN/HK equity/ETF API, with bounded disk caching."""
import argparse
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import re
from pathlib import Path
import threading
import time
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit

from instruments import INDEXES, normalize_symbol
from update_data import NY, ROOT, DEFAULT_SYMBOLS, ETF_VOLATILITY, CALCULATION_VERSION, build_etf, fetch_etf, fetch_vol, last_closed_day, download

CACHE = Path(os.environ.get('MARKET_CACHE_DIR', str(ROOT / 'data/instruments')))
SNAPSHOT = Path(os.environ.get('MARKET_SNAPSHOT', str(ROOT / 'public/data/market.json')))
POOL = ThreadPoolExecutor(max_workers=3)
LOCK = threading.Lock()
PENDING = {}
FAILURES = {}
VOL_LOCK = threading.Lock()
REQUEST_LOCK = threading.Lock()
NEXT_REQUEST = 0
BACKOFF_UNTIL = 0
READ_CACHE = OrderedDict()
READ_LOCK = threading.Lock()


def paced_fetch(symbol):
    global NEXT_REQUEST, BACKOFF_UNTIL
    with REQUEST_LOCK:
        if time.time() < BACKOFF_UNTIL:
            raise RuntimeError('upstream_backoff')
        time.sleep(max(0, NEXT_REQUEST - time.monotonic()))
        NEXT_REQUEST = time.monotonic() + 1
    try:
        return fetch_etf(symbol, require_full_history=False, validate_us=True, save_raw=False)
    except HTTPError as error:
        if error.code == 429:
            with REQUEST_LOCK:
                BACKOFF_UNTIL = time.time() + 900
        raise


def read_json(path):
    try:
        stamp = path.stat()
        version = (stamp.st_mtime_ns, stamp.st_size)
        with READ_LOCK:
            cached = READ_CACHE.get(path)
            if cached and cached[0] == version:
                READ_CACHE.move_to_end(path)
                return cached[1]
        value = json.loads(path.read_text(encoding='utf-8'))
        with READ_LOCK:
            READ_CACHE[path] = (version, value)
            READ_CACHE.move_to_end(path)
            while len(READ_CACHE) > 8 or sum(item[0][1] for item in READ_CACHE.values()) > 16 * 1024 * 1024:
                READ_CACHE.popitem(last=False)
        return value
    except (OSError, ValueError):
        return None


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, allow_nan=False, separators=(',', ':')), encoding='utf-8')
    os.replace(temporary, path)


def fresh(entry, symbol):
    if entry.get('version') != CALCULATION_VERSION:
        return False
    if symbol.endswith('.OF') and entry['data']['date'] < last_closed_day(symbol):
        return time.time() - entry.get('created', 0) < 900
    if ETF_VOLATILITY.get(symbol) and not entry['data'].get('volatilitySymbol'):
        return entry.get('asOf') == last_closed_day(symbol) and time.time() - entry.get('created', 0) < 900
    return entry.get('asOf') == last_closed_day(symbol)


def volatility_history(symbol):
    with VOL_LOCK:
        path = CACHE / ('_vol_' + symbol + '.json')
        cached = read_json(path)
        if cached and cached.get('asOf') == last_closed_day():
            return cached['rows']
        if cached and time.time() - cached.get('attempted', 0) < 900:
            return cached['rows']
        try:
            _, rows = fetch_vol(symbol, require_full_history=False)
            write_json(path, {'asOf': last_closed_day(), 'created': time.time(), 'rows': rows})
            return rows
        except Exception:
            rows = cached['rows'] if cached else []
            write_json(path, {'asOf': cached.get('asOf') if cached else None, 'attempted': time.time(), 'rows': rows})
            return rows


def refresh(symbol):
    try:
        path = CACHE / (symbol + '.json')
        previous = read_json(path)
        # A calculation upgrade or volatility retry can reuse the exact saved
        # adjusted prices without asking Yahoo for the same closing day again.
        if previous and previous.get('asOf') == last_closed_day(symbol) and previous.get('rows'):
            rows = previous['rows']
        else:
            _, rows = paced_fetch(symbol)
        vol_symbol = ETF_VOLATILITY.get(symbol)
        volatility = {vol_symbol: volatility_history(vol_symbol)} if vol_symbol else {}
        data = build_etf(symbol, rows, volatility)
        if previous and (data['date'] < previous['data']['date'] or data['observationCount'] < previous['data']['observationCount'] - 5):
            raise RuntimeError('history_regressed')
        write_json(path, {'version': CALCULATION_VERSION, 'asOf': last_closed_day(symbol), 'created': time.time(), 'rows': rows, 'data': data})
        # Bound persistent storage; only validated symbols ever create files.
        with LOCK:
            files = sorted((p for p in CACHE.glob('*.json') if not p.name.startswith('_')), key=lambda p: p.stat().st_mtime)
            for expired in files[:-512]:
                expired.unlink(missing_ok=True)
        return data
    except Exception as error:
        with LOCK:
            if len(FAILURES) >= 512:
                FAILURES.clear()
            FAILURES[symbol] = (time.time(), error)
        raise


def instrument(symbol):
    if symbol in DEFAULT_SYMBOLS:
        snapshot = read_json(SNAPSHOT.parent / (symbol + '.json'))
        if snapshot and snapshot.get('calculationVersion') == CALCULATION_VERSION:
            return snapshot
    cached = read_json(CACHE / (symbol + '.json'))
    if cached and fresh(cached, symbol):
        return cached['data']
    with LOCK:
        failed = FAILURES.get(symbol)
        retry_after = 900 if failed and isinstance(failed[1], HTTPError) and failed[1].code in (404, 429) else 60
        if failed and time.time() - failed[0] < retry_after:
            if cached and cached.get('version') == CALCULATION_VERSION:
                return cached['data']
            raise failed[1]
        for key, pending in list(PENDING.items()):
            if key != symbol and pending.done():
                PENDING.pop(key, None)
        future = PENDING.get(symbol)
        if future is None:
            if len(PENDING) >= 12:
                raise RuntimeError('busy')
            future = POOL.submit(refresh, symbol)
            PENDING[symbol] = future
    # Existing visitors get the last complete cached close immediately while
    # one background task updates it; cold symbols wait for real data.
    if cached and cached.get('version') == CALCULATION_VERSION:
        return cached['data']
    try:
        return future.result(timeout=150)
    except Exception:
        if cached and cached.get('version') == CALCULATION_VERSION:
            return cached['data']
        raise
    finally:
        with LOCK:
            if future.done() and PENDING.get(symbol) is future:
                PENDING.pop(symbol, None)


def candidate_name(item):
    symbol = item['symbol']
    if item.get('name') and item['name'] != symbol:
        return item['name']
    path = CACHE / f'_name_{symbol}.json'
    cached = read_json(path)
    if cached and cached.get('name'):
        return cached['name']
    try:
        if symbol.endswith('.OF'):
            _, rows = fetch_etf(symbol, require_full_history=False, save_raw=False)
            name = rows[0].get('fundName')
            if name:
                write_json(path, {'name': name})
                return name
        if re.fullmatch(r'\d{6}\.(SS|SZ)', symbol):
            ticker = ('sh' if symbol.endswith('.SS') else 'sz') + symbol[:6]
            quote = download(f'https://qt.gtimg.cn/q={ticker}', timeout=6, attempts=1).decode('gb18030')
            match = re.search(r'v_' + ticker + r'="([^"]+)"', quote)
            fields = match[1].split('~') if match else []
            if len(fields) > 2 and fields[2] == symbol[:6] and fields[1]:
                write_json(path, {'name': fields[1]})
                return fields[1]
    except Exception:
        pass
    try:
        payload = json.loads(download(f'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=1d&interval=1d', timeout=10, attempts=1))
        meta = payload['chart']['result'][0]['meta']
        if meta.get('symbol', '').upper() == symbol:
            name = meta.get('longName') or meta.get('shortName')
            if name:
                write_json(path, {'name': name})
                return name
    except Exception:
        pass
    return symbol


def search_candidates(query):
    if not re.fullmatch(r'\d{6}', query):
        raise ValueError('invalid_symbol')
    codes = [query + '.OF']
    try:
        stock = normalize_symbol(query)
        if stock not in INDEXES and not stock.endswith('.OF'):
            codes.insert(0, stock)
    except ValueError:
        pass
    matches = []
    # Separate workers may wait for the shared fetch pool without deadlocking it.
    with ThreadPoolExecutor(max_workers=2) as workers:
        futures = [(code, workers.submit(instrument, code)) for code in codes]
        for code, future in futures:
            try:
                item = future.result()
            except HTTPError as error:
                if error.code == 404:
                    continue
                raise
            except ValueError as error:
                if str(error) in ('unsupported_fund', 'unsupported_instrument', 'no_history'):
                    continue
                raise
            if item.get('symbol') != code or item.get('kind') not in ('security', 'fund'):
                raise ValueError('invalid_search_result')
            matches.append(item)
    return [{'symbol': item['symbol'], 'kind': item['kind'], 'name': candidate_name(item) if len(matches) > 1 else item.get('name', item['symbol'])} for item in matches]


class Handler(BaseHTTPRequestHandler):
    def send_json(self, status, data):
        body = json.dumps(data, allow_nan=False, separators=(',', ':')).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        if status == 503:
            self.send_header('Retry-After', '900' if time.time() < BACKOFF_UNTIL else '60')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlsplit(self.path)
        if parsed.path != '/api/market':
            return self.send_json(404, {'error': 'not_found'})
        try:
            params = parse_qs(parsed.query)
            if 'search' in params:
                return self.send_json(200, {'candidates': search_candidates(params['search'][0].strip())})
            symbol = normalize_symbol(params.get('symbol', [''])[0])
            if symbol in INDEXES:
                raise ValueError('unsupported_instrument')
            self.send_json(200, instrument(symbol))
        except ValueError as error:
            code = str(error)
            self.send_json(400 if code == 'invalid_symbol' else 422, {'error': code if code in ('invalid_symbol', 'unsupported_instrument', 'unsupported_fund', 'no_history') else 'unavailable'})
        except HTTPError as error:
            self.send_json(404 if error.code == 404 else 503, {'error': 'not_found' if error.code == 404 else 'unavailable'})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            self.send_json(503, {'error': 'unavailable'})


def daily_refresh():
    # Requested symbols continue receiving post-close updates without a browser open.
    while True:
        time.sleep(60)
        for path in list(CACHE.glob('*.json')):
            if path.name.startswith('_') or path.stem in INDEXES:
                continue
            entry = read_json(path)
            if entry and not fresh(entry, path.stem):
                try:
                    instrument(normalize_symbol(path.stem))
                except Exception:
                    pass


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8081)
    args = parser.parse_args()
    CACHE.mkdir(parents=True, exist_ok=True)
    threading.Thread(target=daily_refresh, daemon=True).start()
    ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
