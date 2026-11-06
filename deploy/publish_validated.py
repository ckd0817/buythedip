"""Publish already validated real snapshots atomically before a frontend switch."""
import fcntl
import json
import os
from pathlib import Path
import pwd
import sys

release = Path(sys.argv[1]).resolve()
destination = Path(sys.argv[2]).resolve()
sys.path.insert(0, str(release / 'scripts'))
from update_data import DEFAULT_SYMBOLS, CALCULATION_VERSION, last_closed_day

payloads = {}
for symbol in DEFAULT_SYMBOLS:
    body = (release / 'dist/data' / f'{symbol}.json').read_bytes()
    data = json.loads(body)
    assert data['symbol'] == symbol and data['calculationVersion'] == CALCULATION_VERSION
    assert set(data['windows']) == {'3', '5', '10', 'all'}
    assert data['date'] <= last_closed_day(symbol)
    assert data['windows']['all']['chart'][-1]['date'] == data['date']
    if data['kind'] == 'index':
        assert data['priceBasis'] == 'indexClose'
        assert abs(data['windows']['all']['chart'][-1]['price'] - data['close']) < .0001
    payloads[f'{symbol}.json'] = body
market = (release / 'dist/data/market.json').read_bytes()
assert set(json.loads(market)['etfs']) == set(DEFAULT_SYMBOLS)
payloads['market.json'] = market
account = pwd.getpwnam('buythedip')
destination.mkdir(parents=True, exist_ok=True)
with (destination / '.update.lock').open('a') as lock:
    os.fchown(lock.fileno(), account.pw_uid, account.pw_gid)
    fcntl.flock(lock, fcntl.LOCK_EX)
    for filename in payloads:
        existing = destination / filename
        if filename != 'market.json' and existing.exists():
            assert json.loads(existing.read_bytes())['date'] <= json.loads(payloads[filename])['date'], 'Refusing a history-date regression'
    for directory in (destination, release / 'public/data'):
        directory.mkdir(parents=True, exist_ok=True)
        for filename, body in payloads.items():
            temporary = directory / ('.' + filename + '.publish.tmp')
            temporary.write_bytes(body)
            os.chown(temporary, account.pw_uid, account.pw_gid)
            temporary.chmod(0o644)
            os.replace(temporary, directory / filename)
print('Published validated real-data snapshots.')
