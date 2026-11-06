const snapshots = /^\/data\/(SPY|QQQ|SMH|market)\.json$/;
const ticker = /^(?:[A-Z0-9][A-Z0-9.-]{0,19})$/;

function failure(status, error) {
  return Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function handleRequest(request, env, ctx, { fetchOrigin = fetch, cache } = {}) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/data/')) {
    return env.ASSETS.fetch(request);
  }
  if (!['GET', 'HEAD'].includes(request.method)) {
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' } });
  }
  const snapshot = snapshots.test(url.pathname);
  if (!snapshot && url.pathname !== '/api/market') return failure(404, 'not_found');

  // Only canonical public market requests may reach the private origin.
  const target = new URL(url.pathname, env.ORIGIN_BASE);
  if (!snapshot) {
    const symbol = url.searchParams.get('symbol');
    const search = url.searchParams.get('search');
    if (url.searchParams.size !== 1 || (symbol == null) === (search == null)) return failure(400, 'invalid_query');
    if (search != null) {
      if (!/^\d{6}$/.test(search)) return failure(400, 'invalid_query');
      target.searchParams.set('search', search);
    } else {
      const canonical = symbol.toUpperCase();
      if (!ticker.test(canonical)) return failure(400, 'invalid_query');
      target.searchParams.set('symbol', canonical);
    }
  }
  const cacheControl = `public, max-age=0, s-maxage=${snapshot ? 300 : 60}`;
  const cacheUrl = new URL(url.pathname, url.origin);
  cacheUrl.search = target.search;
  const key = new Request(cacheUrl, { method: 'GET' });
  const cached = await cache?.match(key);
  if (cached) return responseFor(request, cached, 'HIT', cacheControl);

  let upstream;
  try {
    upstream = await fetchOrigin(target.href, {
      method: 'GET', headers: { Accept: 'application/json' }, redirect: 'manual',
    });
  } catch {
    return failure(502, 'origin_unavailable');
  }
  // An HTML error page or redirect must never be cached as market data.
  const json = upstream.headers.get('Content-Type')?.includes('application/json');
  if (!upstream.ok || !json) {
    let error = 'market_unavailable';
    if (json && upstream.status >= 400) {
      try {
        const data = await upstream.json();
        if (typeof data.error === 'string' && /^[a-z_]{1,64}$/.test(data.error)) error = data.error;
      } catch { /* Invalid origin responses remain unavailable. */ }
    }
    return failure(upstream.status >= 400 ? upstream.status : 502, error);
  }
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': cacheControl,
    'X-Content-Type-Options': 'nosniff',
  });
  const response = new Response(upstream.body, { status: 200, headers });
  if (cache) ctx.waitUntil(cache.put(key, response.clone()).catch(() => {}));
  return responseFor(request, response, 'MISS', cacheControl);
}

function responseFor(request, response, state, cacheControl) {
  const headers = new Headers(response.headers);
  headers.set('X-Market-Cache', state);
  // Zone Browser Cache TTL can rewrite max-age on cache matches; browsers must revalidate market data.
  headers.set('Cache-Control', cacheControl);
  return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, headers });
}

export default {
  fetch(request, env, ctx) {
    return handleRequest(request, env, ctx, { cache: caches.default });
  },
};
