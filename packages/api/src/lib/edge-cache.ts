export interface EdgeCacheOptions {
  /** Seconds a stored copy is served without revalidation. */
  freshSeconds: number;
  /** Extra seconds a stale copy may be served while it refreshes. */
  staleSeconds: number;
  /** Clock override for tests. */
  now?: () => number;
}

/**
 * Short-lived edge cache for the public read API.
 *
 * Every public data request used to cost one or more GitHub Contents API
 * calls plus a decrypt. With no cache that put the whole content API behind
 * a ~5,000 request/hour upstream budget and 0.4-2.2s TTFB.
 *
 * Behaviour:
 *   fresh    -> serve the cached copy (x-cache: HIT)
 *   stale    -> serve the cached copy immediately, refresh in the background
 *               (stale-while-revalidate, x-cache: STALE)
 *   expired  -> block on a fresh build; on failure fall back to whatever is
 *               cached rather than returning a 500 (x-cache: STALE-ERROR)
 *   cold     -> build, store, serve (x-cache: MISS)
 *
 * The cache key is the request pathname only, so cache-busting query strings
 * do not fragment the cache or reach GitHub.
 */

const INTERNAL_CACHE_ORIGIN = 'https://content-cache.internal';
const CACHED_AT_HEADER = 'x-cached-at';

function cacheKeyFor(request: Request): Request {
  const { pathname } = new URL(request.url);
  return new Request(`${INTERNAL_CACHE_ORIGIN}${pathname}`, { method: 'GET' });
}

function withCacheStatus(response: Response, status: string): Response {
  const out = new Response(response.body, response);
  out.headers.set('x-cache', status);
  return out;
}

export async function cachedResponse(
  request: Request,
  options: EdgeCacheOptions,
  ctx: { waitUntil(promise: Promise<unknown>): void } | undefined,
  produce: () => Response | Promise<Response>,
): Promise<Response> {
  const cache = (globalThis as { caches?: CacheStorage }).caches?.default;
  if (!cache) return produce();

  const { freshSeconds, staleSeconds } = options;
  const now = options.now ?? Date.now;
  const key = cacheKeyFor(request);
  const cached = await cache.match(key);

  if (cached) {
    const cachedAt = Number(cached.headers.get(CACHED_AT_HEADER) || 0);
    const ageSeconds = (now() - cachedAt) / 1000;

    if (ageSeconds < freshSeconds) {
      return withCacheStatus(cached, 'HIT');
    }

    if (ageSeconds < freshSeconds + staleSeconds) {
      // Stale-while-revalidate: answer now, refresh for the next caller.
      const refresh = Promise.resolve(produce())
        .then((freshResponse) => store(cache, key, freshResponse, options))
        .catch(() => undefined);
      if (ctx) ctx.waitUntil(refresh);
      else await refresh;
      return withCacheStatus(cached, 'STALE');
    }
  }

  try {
    const response = await produce();
    await store(cache, key, response.clone(), options);
    return withCacheStatus(response, cached ? 'REFRESHED' : 'MISS');
  } catch (error) {
    if (cached) {
      // Upstream (GitHub) is down or rate limited: a stale answer beats a 500.
      return withCacheStatus(cached, 'STALE-ERROR');
    }
    throw error;
  }
}

async function store(
  cache: Cache,
  key: Request,
  response: Response,
  options: EdgeCacheOptions,
): Promise<void> {
  if (!response.ok) return;
  const now = options.now ?? Date.now;
  const toStore = new Response(response.body, response);
  toStore.headers.set(
    'cache-control',
    `public, max-age=${options.freshSeconds}, stale-while-revalidate=${options.staleSeconds}`,
  );
  toStore.headers.set(CACHED_AT_HEADER, String(now()));
  try {
    await cache.put(key, toStore);
  } catch {
    // Cache writes are best-effort; never fail a request over them.
  }
}

/** Exposed for tests and admin invalidation. */
export function edgeCacheKey(pathname: string): Request {
  return new Request(`${INTERNAL_CACHE_ORIGIN}${pathname}`, { method: 'GET' });
}
