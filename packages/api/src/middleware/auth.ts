// Admin session auth for the Worker. Two credentials are accepted (see getAuthenticatedAdmin):
//   1. HTTP Basic with username "admin" and the admin password.
//   2. The admin_session cookie: base64(JSON {sub, iat, exp}) + "." + base64(HMAC-SHA256(secret, payload)).
// Password check (verifyPassword): plaintext ADMIN_PASSWORD wins when set. ADMIN_PASSWORD_HASH
// ("scrypt$<salt-b64>$<hash-b64>") is only consulted when ADMIN_PASSWORD is empty.
//
// Session TTL: ADMIN_SESSION_TTL_SECONDS (getSessionTtlSeconds). Unset, empty, non-integer, or <= 0 falls
// back to 8 hours. The token exp and the cookie Max-Age both use the same value.
// The session signature is compared in constant time (timingSafeEqual).
//
// KNOWN LIMITATIONS (not fixed):
// 1. Session signing key = ADMIN_SESSION_SECRET, falling back to ADMIN_PASSWORD (getSessionSecret). This is a
//    known limitation: the fallback needs a deployment change to remove. Until ADMIN_SESSION_SECRET is set,
//    changing ADMIN_PASSWORD changes the signing key and logs out every session. The password is also the
//    session key, so the two cannot be rotated independently.
// 2. The Basic header is split with decoded.split(':'), so a password that contains ":" is truncated at
//    the second colon, and login with the full password fails.
import crypto from 'node:crypto';

export interface Env {
  DB: D1Database;
  ADMIN_PASSWORD: string;
  ADMIN_PASSWORD_HASH?: string;
  ADMIN_SESSION_SECRET?: string;
  ADMIN_SESSION_TTL_SECONDS?: string;
  CORS_ORIGIN: string;
}

export const DEFAULT_SESSION_TTL_SECONDS = 8 * 60 * 60;

/** ADMIN_SESSION_TTL_SECONDS as a positive integer; any other value gives the 8-hour default. */
export function getSessionTtlSeconds(env: Env): number {
  const raw = String(env.ADMIN_SESSION_TTL_SECONDS ?? '').trim();
  if (!/^\d+$/.test(raw)) return DEFAULT_SESSION_TTL_SECONDS;
  const seconds = Number(raw);
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : DEFAULT_SESSION_TTL_SECONDS;
}

export function getSessionSecret(env: Env): string {
  const secret = env.ADMIN_SESSION_SECRET || env.ADMIN_PASSWORD || '';
  if (secret.length < 8) {
    throw new Error('ADMIN_SESSION_SECRET or ADMIN_PASSWORD must be set (min 8 chars).');
  }
  return secret;
}

async function sign(secret: string, value: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret) as Uint8Array<ArrayBuffer>;
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigData = encoder.encode(value) as Uint8Array<ArrayBuffer>;
  const sig = await crypto.subtle.sign('HMAC', key, sigData);
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export async function createSessionToken(
  env: Env,
  adminUser = 'admin',
): Promise<string> {
  const secret = getSessionSecret(env);
  const ttlSeconds = getSessionTtlSeconds(env);
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + ttlSeconds;
  const payload = { sub: adminUser, iat, exp };
  const encodedPayload = btoa(JSON.stringify(payload));
  const signature = await sign(secret, encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export async function verifySessionToken(
  env: Env,
  token: string,
): Promise<{ sub: string; iat: number; exp: number } | null> {
  if (!token || typeof token !== 'string') return null;
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) return null;

  const secret = getSessionSecret(env);
  const expected = await sign(secret, encodedPayload);
  // Constant-time compare. timingSafeEqual returns false for unequal lengths before comparing bytes.
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

  let payload: { sub: string; iat: number; exp: number };
  try {
    payload = JSON.parse(atob(encodedPayload));
  } catch {
    return null;
  }

  if (!payload?.sub || typeof payload.exp !== 'number') return null;
  if (Math.floor(Date.now() / 1000) >= payload.exp) return null;
  return payload;
}

export function parseCookies(headers: Headers): Record<string, string> {
  const raw = headers.get('cookie') || '';
  const out: Record<string, string> = {};
  for (const pair of raw.split(';')) {
    const i = pair.indexOf('=');
    if (i <= 0) continue;
    const key = pair.slice(0, i).trim();
    const value = pair.slice(i + 1).trim();
    out[key] = value;
  }
  return out;
}

export async function getAuthenticatedAdmin(
  env: Env,
  headers: Headers,
): Promise<{ username: string } | null> {
  const authHeader = headers.get('authorization');
  if (authHeader?.startsWith('Basic ')) {
    const decoded = atob(authHeader.slice(6));
    const [username, password] = decoded.split(':');
    if (username === 'admin' && verifyPassword(env, password)) {
      return { username };
    }
  }

  const cookies = parseCookies(headers);
  const token = cookies['admin_session'];
  if (token) {
    const session = await verifySessionToken(env, token);
    if (session) {
      return { username: session.sub };
    }
  }

  return null;
}

export function verifyPassword(env: Env, password: string): boolean {
  if (typeof password !== 'string' || password.length === 0) return false;

  // Try plaintext comparison first
  const plain = env.ADMIN_PASSWORD || '';
  if (plain) {
    if (plain.length !== password.length) return false;
    return timingSafeEqual(Buffer.from(password), Buffer.from(plain));
  }

  // Fallback: scrypt hash
  const encoded = env.ADMIN_PASSWORD_HASH || '';
  if (!encoded) return false;

  const parts = encoded.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;

  try {
    const salt = Buffer.from(parts[1], 'base64');
    const expected = Buffer.from(parts[2], 'base64');
    const derived = crypto.scryptSync(password, salt, expected.length);
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

function timingSafeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}

export function makeSessionCookie(
  token: string,
  maxAgeSeconds: number = DEFAULT_SESSION_TTL_SECONDS,
): string {
  return `admin_session=${token}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=None; Secure`;
}

export function clearSessionCookie(): string {
  return 'admin_session=; Path=/; Max-Age=0; HttpOnly; SameSite=None; Secure';
}
