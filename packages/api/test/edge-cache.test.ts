import { describe, it, expect } from 'vitest';
import { cachedResponse, type EdgeCacheOptions } from '../src/lib/edge-cache';

const T0 = 1_800_000_000_000;

/** Options with a controllable clock so cache ageing is deterministic. */
function optionsAt(clock: { t: number }, overrides: Partial<EdgeCacheOptions> = {}): EdgeCacheOptions {
  return {
    freshSeconds: 300,
    staleSeconds: 3600,
    now: () => clock.t,
    ...overrides,
  };
}

function makeCtx() {
  const pending: Promise<unknown>[] = [];
  return {
    ctx: {
      waitUntil: (promise: Promise<unknown>) => {
        pending.push(promise);
      },
    },
    settle: () => Promise.all(pending),
  };
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('cachedResponse', () => {
  it('builds once and serves the stored copy on the next call', async () => {
    let builds = 0;
    const clock = { t: T0 };
    const produce = async () => jsonResponse({ build: ++builds });
    const request = new Request('https://content.jovylle.com/data/cache-test-hit.json');
    const opts = optionsAt(clock);

    const first = await cachedResponse(request, opts, makeCtx().ctx, produce);
    expect(first.headers.get('x-cache')).toBe('MISS');

    const second = await cachedResponse(request, opts, makeCtx().ctx, produce);
    expect(second.headers.get('x-cache')).toBe('HIT');
    expect(builds).toBe(1);
    expect(await second.json()).toEqual({ build: 1 });
  });

  it('keys on the pathname so query strings do not fragment the cache', async () => {
    let builds = 0;
    const clock = { t: T0 };
    const opts = optionsAt(clock);
    const produce = async () => jsonResponse({ build: ++builds });

    await cachedResponse(
      new Request('https://content.jovylle.com/data/cache-test-query.json'),
      opts,
      makeCtx().ctx,
      produce,
    );
    const hit = await cachedResponse(
      new Request('https://content.jovylle.com/data/cache-test-query.json?cb=123'),
      opts,
      makeCtx().ctx,
      produce,
    );

    expect(hit.headers.get('x-cache')).toBe('HIT');
    expect(builds).toBe(1);
  });

  it('serves stale while refreshing in the background', async () => {
    const clock = { t: T0 };
    const opts = optionsAt(clock);
    const request = new Request('https://content.jovylle.com/data/cache-test-stale.json');
    let builds = 0;
    const produce = async () => jsonResponse({ build: ++builds });

    await cachedResponse(request, opts, makeCtx().ctx, produce);

    // Past the fresh window, still inside the stale window.
    clock.t = T0 + 600_000;
    const { ctx, settle } = makeCtx();
    const res = await cachedResponse(request, opts, ctx, produce);

    expect(res.headers.get('x-cache')).toBe('STALE');
    expect(await res.json()).toEqual({ build: 1 });

    await settle();

    const refreshed = await cachedResponse(request, opts, makeCtx().ctx, produce);
    expect(refreshed.headers.get('x-cache')).toBe('HIT');
    expect(await refreshed.json()).toEqual({ build: 2 });
  });

  it('falls back to a stale copy when the upstream build fails', async () => {
    const clock = { t: T0 };
    const opts = optionsAt(clock, { freshSeconds: 60, staleSeconds: 60 });
    const request = new Request('https://content.jovylle.com/data/cache-test-error.json');

    await cachedResponse(request, opts, makeCtx().ctx, async () => jsonResponse({ ok: true }));

    // Well past fresh + stale, so the read has to go upstream.
    clock.t = T0 + 3_600_000;
    const res = await cachedResponse(request, opts, makeCtx().ctx, async () => {
      throw new Error('github unavailable');
    });

    expect(res.headers.get('x-cache')).toBe('STALE-ERROR');
    expect(await res.json()).toEqual({ ok: true });
  });

  it('rethrows when the upstream fails and nothing is cached', async () => {
    await expect(
      cachedResponse(
        new Request('https://content.jovylle.com/data/cache-test-cold-error.json'),
        optionsAt({ t: T0 }),
        makeCtx().ctx,
        async () => {
          throw new Error('github unavailable');
        },
      ),
    ).rejects.toThrow('github unavailable');
  });

  it('does not cache non-ok responses', async () => {
    const clock = { t: T0 };
    const opts = optionsAt(clock);
    const request = new Request('https://content.jovylle.com/data/cache-test-500.json');

    const first = await cachedResponse(request, opts, makeCtx().ctx, async () =>
      jsonResponse({ error: 'boom' }, 500),
    );
    expect(first.status).toBe(500);

    const second = await cachedResponse(request, opts, makeCtx().ctx, async () =>
      jsonResponse({ ok: true }),
    );
    expect(second.headers.get('x-cache')).toBe('MISS');
    expect(second.status).toBe(200);
  });
});
