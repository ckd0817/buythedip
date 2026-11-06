import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../worker/index.mjs';

function setup() {
  const items = new Map(), tasks = [], requests = [];
  const env = { ORIGIN_BASE: 'https://origin.example', ASSETS: { fetch: () => new Response('frontend') } };
  const ctx = { waitUntil: task => tasks.push(task) };
  const cache = {
    async match(key) { return items.get(key.url)?.clone(); },
    async put(key, response) { items.set(key.url, response); },
  };
  const fetchOrigin = async (url, options) => {
    requests.push({ url, options });
    return Response.json({ symbol: 'QQQ' });
  };
  const run = (path, options = {}, dependencies = {}) => handleRequest(new Request('https://app.example' + path, options), env, ctx, { cache, fetchOrigin, ...dependencies });
  return { run, requests, tasks, items };
}

test('frontend assets do not go to VPS; only whitelisted market paths proxy', async () => {
  const s = setup();
  assert.equal(await (await s.run('/')).text(), 'frontend');
  assert.equal((await s.run('/data/private.json')).status, 404);
  assert.equal((await s.run('/api/other')).status, 404);
  assert.equal(s.requests.length, 0);
});

test('canonical stock requests cache once and HEAD omits body', async () => {
  const s = setup();
  const first = await s.run('/api/market?symbol=qqq');
  assert.equal(first.headers.get('X-Market-Cache'), 'MISS');
  await Promise.all(s.tasks);
  const next = await s.run('/api/market?symbol=QQQ');
  assert.equal(next.headers.get('X-Market-Cache'), 'HIT');
  assert.equal(s.requests.length, 1);
  assert.equal(s.requests[0].url, 'https://origin.example/api/market?symbol=QQQ');
  const head = await s.run('/api/market?symbol=QQQ', { method: 'HEAD' });
  assert.equal(await head.text(), '');
});

test('snapshot cache TTL differs from dynamic quote TTL', async () => {
  const s = setup();
  assert.match((await s.run('/data/QQQ.json')).headers.get('Cache-Control'), /s-maxage=300/);
  assert.match((await s.run('/api/market?search=000001')).headers.get('Cache-Control'), /s-maxage=60/);
});

test('cache hits keep browser max-age=0 even if the edge rewrites it', async () => {
  const s = setup();
  s.items.set('https://app.example/data/QQQ.json', Response.json({}, { headers: { 'Cache-Control': 'public, max-age=14400, s-maxage=300' } }));
  const hit = await s.run('/data/QQQ.json');
  assert.equal(hit.headers.get('X-Market-Cache'), 'HIT');
  assert.equal(hit.headers.get('Cache-Control'), 'public, max-age=0, s-maxage=300');
});

test('invalid requests cannot send arbitrary parameters or credentials upstream', async () => {
  const s = setup();
  for (const path of ['/api/market', '/api/market?symbol=QQQ&symbol=SPY', '/api/market?symbol=QQQ&search=000001', '/api/market?symbol=https://bad.example', '/api/market?search=123', '/api/market?symbol=QQQ&url=https://bad.example']) {
    assert.equal((await s.run(path)).status, 400);
  }
  assert.equal((await s.run('/api/market?symbol=QQQ', { method: 'POST' })).status, 405);
  await s.run('/api/market?symbol=QQQ', { headers: { Cookie: 'private=1', Authorization: 'secret' } });
  assert.deepEqual(s.requests[0].options.headers, { Accept: 'application/json' });
});

test('origin failures, redirects and HTML never enter the edge cache; error codes survive', async () => {
  for (const fetchOrigin of [
    async () => { throw new Error('offline'); },
    async () => new Response('error', { status: 502 }),
    async () => new Response('login', { headers: { 'Content-Type': 'text/html' } }),
    async () => new Response(null, { status: 302, headers: { Location: 'https://other.example' } }),
    async () => Response.json({ error: 'not_found' }, { status: 404 }),
  ]) {
    const s = setup();
    const response = await s.run('/api/market?symbol=QQQ', {}, { fetchOrigin });
    assert.ok(response.status >= 400);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    if (response.status === 404) assert.equal((await response.json()).error, 'not_found');
    assert.equal(s.items.size, 0);
  }
});
