"""Migrate saved exact price histories to event ranks without upstream requests."""
import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from api import write_json
from instruments import market_timezone
from metrics import drawdowns, drawdown_event_percentiles, drawdown_event_quantiles
from update_data import ROOT, CALCULATION_VERSION, DEFAULT_SYMBOLS


def recalculate(item, rows):
    rows = [r for r in rows if r['date'] <= item['date']]
    if len(rows) != item['observationCount'] or rows[-1]['date'] != item['date']:
        raise ValueError(f"{item['symbol']}: exact history does not match snapshot")
    dates = [r['date'] for r in rows]
    prices = [r['adjustedClose'] for r in rows]
    chart = item['windows']['all']['chart']
    if len(chart) != len(rows) or any(p['date'] != r['date'] or abs(p['price'] - r['adjustedClose']) > .000051 for p, r in zip(chart, rows)):
        raise ValueError(f"{item['symbol']}: saved prices differ from snapshot")
    depths = drawdowns(prices)
    for key, window in item['windows'].items():
        ranks, counts = drawdown_event_percentiles(dates, depths, None if key == 'all' else int(key))
        by_date = dict(zip(dates, ranks))
        window['index'] = ranks[-1]
        window['drawdownSampleCount'] = window['drawdownEventCount'] = counts[-1]
        for point in window['chart']:
            rank = by_date[point['date']]
            point['index'] = None if rank is None else round(rank, 3)
    item['drawdownQuantiles'] = drawdown_event_quantiles(depths)
    item['calculationVersion'] = CALCULATION_VERSION
    return item


def migrate(snapshot_dir, cache_dir):
    market = json.loads((snapshot_dir / 'market.json').read_text(encoding='utf-8'))
    # Validate every fixed instrument before publishing any changed snapshot.
    updates = {}
    for symbol in DEFAULT_SYMBOLS:
        item = market['etfs'][symbol]
        raw = json.loads((ROOT / 'data/raw' / f'{symbol}.json').read_text(encoding='utf-8'))['chart']['result'][0]
        rows = []
        for stamp, value in zip(raw['timestamp'], raw['indicators']['adjclose'][0]['adjclose']):
            if value is not None:
                day = datetime.fromtimestamp(stamp, timezone.utc).astimezone(market_timezone(symbol)).date().isoformat()
                rows.append({'date': day, 'adjustedClose': value})
        updates[symbol] = recalculate(item, rows)
    for symbol, item in updates.items():
        write_json(snapshot_dir / f'{symbol}.json', item)
        market['etfs'][symbol] = item
        print(symbol, item['date'], item['windows']['all']['index'], item['windows']['all']['drawdownEventCount'])
    write_json(snapshot_dir / 'market.json', market)
    for path in cache_dir.glob('*.json'):
        if path.name.startswith('_'):
            continue
        entry = json.loads(path.read_text(encoding='utf-8'))
        if entry.get('rows') and entry.get('data', {}).get('kind') in ('security', 'fund'):
            try:
                entry['data'] = recalculate(entry['data'], entry['rows'])
            except ValueError as error:
                # An unmatched legacy cache must refresh normally; the API
                # rejects its old calculation version instead of serving it.
                print('Retained for refresh:', error)
                continue
            entry['version'] = CALCULATION_VERSION
            write_json(path, entry)
            print('cache', path.stem)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--snapshots', type=Path, default=ROOT / 'public/data')
    parser.add_argument('--cache', type=Path, default=ROOT / 'data/instruments')
    args = parser.parse_args()
    # Same publication lock as the daily updater.
    with (args.snapshots / '.update.lock').open('a') as lock:
        if os.name == 'posix':
            import fcntl
            fcntl.flock(lock, fcntl.LOCK_EX)
        migrate(args.snapshots, args.cache)
