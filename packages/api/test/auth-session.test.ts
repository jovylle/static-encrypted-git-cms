import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createSessionToken,
  verifySessionToken,
  makeSessionCookie,
  getSessionTtlSeconds,
  getAuthenticatedAdmin,
  resetSessionTtlWarningsForTests,
  DEFAULT_SESSION_TTL_SECONDS,
  MAX_SESSION_TTL_SECONDS,
  type Env,
} from '../src/middleware/auth';

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    ADMIN_PASSWORD: 'test-password',
    CORS_ORIGIN: '*',
    ...overrides,
  } as Env;
}

function decodePayload(token: string): { sub: string; iat: number; exp: number } {
  return JSON.parse(atob(token.split('.')[0]));
}

afterEach(() => {
  vi.useRealTimers();
  resetSessionTtlWarningsForTests();
});

describe('session TTL', () => {
  it('defaults to 8 hours when ADMIN_SESSION_TTL_SECONDS is unset', async () => {
    const env = makeEnv();
    expect(getSessionTtlSeconds(env)).toBe(DEFAULT_SESSION_TTL_SECONDS);
    expect(DEFAULT_SESSION_TTL_SECONDS).toBe(28800);

    const payload = decodePayload(await createSessionToken(env));
    expect(payload.exp - payload.iat).toBe(28800);
  });

  it('reads ADMIN_SESSION_TTL_SECONDS into the token exp', async () => {
    const env = makeEnv({ ADMIN_SESSION_TTL_SECONDS: '3600' });
    expect(getSessionTtlSeconds(env)).toBe(3600);

    const payload = decodePayload(await createSessionToken(env));
    expect(payload.exp - payload.iat).toBe(3600);
  });

  it.each(['', '   '])('uses 8 hours silently for unset-like value %j', (raw) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(getSessionTtlSeconds(makeEnv({ ADMIN_SESSION_TTL_SECONDS: raw }))).toBe(28800);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it.each(['abc', '0', '-5', '1.5', '1e3'])(
    'falls back to 8 hours with a console.warn for invalid value %j',
    (raw) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(getSessionTtlSeconds(makeEnv({ ADMIN_SESSION_TTL_SECONDS: raw }))).toBe(28800);
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    },
  );

  it('caps a TTL above 30 days at 30 days, with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(getSessionTtlSeconds(makeEnv({ ADMIN_SESSION_TTL_SECONDS: '99999999999999999999999' }))).toBe(MAX_SESSION_TTL_SECONDS);
    expect(getSessionTtlSeconds(makeEnv({ ADMIN_SESSION_TTL_SECONDS: String(MAX_SESSION_TTL_SECONDS + 1) }))).toBe(MAX_SESSION_TTL_SECONDS);
    expect(getSessionTtlSeconds(makeEnv({ ADMIN_SESSION_TTL_SECONDS: String(MAX_SESSION_TTL_SECONDS) }))).toBe(MAX_SESSION_TTL_SECONDS);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('the cookie Max-Age follows the TTL passed in', () => {
    expect(makeSessionCookie('tok')).toContain('Max-Age=28800;');
    expect(makeSessionCookie('tok', 3600)).toContain('Max-Age=3600;');
  });

  it('a token past its TTL no longer verifies', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    const env = makeEnv({ ADMIN_SESSION_TTL_SECONDS: '60' });
    const token = await createSessionToken(env);
    expect(await verifySessionToken(env, token)).not.toBeNull();

    vi.setSystemTime(new Date('2030-01-01T00:01:01Z'));
    expect(await verifySessionToken(env, token)).toBeNull();
  });
});

describe('session signature check', () => {
  it('accepts a freshly signed token', async () => {
    const env = makeEnv();
    const token = await createSessionToken(env, 'admin');
    const session = await verifySessionToken(env, token);
    expect(session?.sub).toBe('admin');
  });

  it('rejects a token whose signature was altered (same length)', async () => {
    const env = makeEnv();
    const token = await createSessionToken(env);
    const [payload, sig] = token.split('.');
    const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
    expect(await verifySessionToken(env, `${payload}.${flipped}`)).toBeNull();
  });

  it('rejects a token whose signature has a different length', async () => {
    const env = makeEnv();
    const token = await createSessionToken(env);
    const [payload, sig] = token.split('.');
    expect(await verifySessionToken(env, `${payload}.${sig.slice(0, -4)}`)).toBeNull();
    expect(await verifySessionToken(env, `${payload}.${sig}AAAA`)).toBeNull();
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await createSessionToken(makeEnv({ ADMIN_SESSION_SECRET: 'secret-one-xxxx' }));
    expect(
      await verifySessionToken(makeEnv({ ADMIN_SESSION_SECRET: 'secret-two-xxxx' }), token),
    ).toBeNull();
  });
});

describe('malformed Basic header', () => {
  it('is unauthorized (null), not an exception', async () => {
    const env = makeEnv();
    for (const header of ['Basic !!!not-base64!!!', 'Basic %%%', 'Basic a']) {
      const headers = new Headers({ authorization: header });
      await expect(getAuthenticatedAdmin(env, headers)).resolves.toBeNull();
    }
  });

  it('is unauthorized when the decoded value has no colon', async () => {
    const env = makeEnv();
    const headers = new Headers({ authorization: `Basic ${btoa('admin')}` });
    await expect(getAuthenticatedAdmin(env, headers)).resolves.toBeNull();
  });

  it('is unauthorized for an empty credential string', async () => {
    const env = makeEnv();
    const headers = new Headers({ authorization: `Basic ${btoa('')}` });
    await expect(getAuthenticatedAdmin(env, headers)).resolves.toBeNull();
  });

  it('warns once per distinct invalid TTL, even when read twice (token exp and cookie Max-Age)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const env = makeEnv({ ADMIN_SESSION_TTL_SECONDS: 'soon' });
    getSessionTtlSeconds(env);
    getSessionTtlSeconds(env);
    await createSessionToken(env);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('still accepts a valid Basic header for admin', async () => {
    const env = makeEnv();
    const headers = new Headers({ authorization: `Basic ${btoa('admin:test-password')}` });
    await expect(getAuthenticatedAdmin(env, headers)).resolves.toEqual({ username: 'admin' });
  });
});
