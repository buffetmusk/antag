import { corsHeaders } from './cors';

export async function cachedFetch(
  request: Request,
  ctx: ExecutionContext,
  cacheKey: string,
  ttlSeconds: number,
  fetchUpstream: () => Promise<unknown>,
): Promise<Response> {
  const cache = caches.default;
  const keyUrl = new URL(cacheKey, request.url).toString();
  const cacheReq = new Request(keyUrl);

  const cached = await cache.match(cacheReq);
  if (cached) return addCors(cached, request, true);

  const data = await fetchUpstream();
  const body = JSON.stringify(data);

  const response = new Response(body, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, s-maxage=${ttlSeconds}`,
      ...corsHeaders(request),
      'X-Cache': 'MISS',
    },
  });

  const staleResponse = new Response(body, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, s-maxage=${ttlSeconds * 5}`,
    },
  });
  const staleReq = new Request(keyUrl + ':stale');

  ctx.waitUntil(
    Promise.all([
      cache.put(cacheReq, response.clone()),
      cache.put(staleReq, staleResponse),
    ]),
  );

  return response;
}

export async function cachedFetchWithFallback(
  request: Request,
  ctx: ExecutionContext,
  cacheKey: string,
  ttlSeconds: number,
  fetchUpstream: () => Promise<unknown>,
): Promise<Response> {
  const cache = caches.default;
  const keyUrl = new URL(cacheKey, request.url).toString();
  const cacheReq = new Request(keyUrl);

  const cached = await cache.match(cacheReq);
  if (cached) return addCors(cached, request, true);

  try {
    return await cachedFetch(request, ctx, cacheKey, ttlSeconds, fetchUpstream);
  } catch (e) {
    const staleReq = new Request(keyUrl + ':stale');
    const stale = await cache.match(staleReq);
    if (stale) return addCors(stale, request, false, true);
    const msg = e instanceof Error ? e.message : 'unknown';
    throw new Error(`Upstream failed for ${cacheKey}: ${msg}`);
  }
}

function addCors(
  response: Response,
  request: Request,
  hit: boolean,
  stale = false,
): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders(request))) headers.set(k, v);
  headers.set('X-Cache', hit ? 'HIT' : stale ? 'STALE' : 'MISS');
  return new Response(response.body, { status: response.status, headers });
}
