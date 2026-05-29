import crypto from 'crypto';

const SESSION_COOKIE = 'admin_session';

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function getSessionSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET || '';
  if (secret.length < 16) {
    throw new Error('ADMIN_SESSION_SECRET must be set (min 16 chars).');
  }
  return secret;
}

function getPasswordHash() {
  const hash = process.env.ADMIN_PASSWORD_HASH || '';
  if (!hash) {
    throw new Error('ADMIN_PASSWORD_HASH must be set.');
  }
  return hash;
}

export function verifyAdminPassword(password) {
  if (typeof password !== 'string' || password.length === 0) return false;
  const encoded = getPasswordHash();
  const parts = encoded.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    throw new Error('ADMIN_PASSWORD_HASH format must be scrypt$<saltB64>$<hashB64>.');
  }

  const salt = Buffer.from(parts[1], 'base64');
  const expected = Buffer.from(parts[2], 'base64');
  const derived = crypto.scryptSync(password, salt, expected.length);
  return crypto.timingSafeEqual(derived, expected);
}

function sign(value) {
  return crypto.createHmac('sha256', getSessionSecret()).update(value).digest('base64url');
}

export function createSessionToken(adminUser = 'admin') {
  const ttlSeconds = Number(process.env.ADMIN_SESSION_TTL_SECONDS || 8 * 60 * 60);
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + ttlSeconds;
  const payload = { sub: adminUser, iat, exp };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) return null;
  const expected = sign(encodedPayload);
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload));
  } catch {
    return null;
  }

  if (!payload?.sub || typeof payload.exp !== 'number') return null;
  if (Math.floor(Date.now() / 1000) >= payload.exp) return null;
  return payload;
}

export function parseCookies(headers = {}) {
  const raw = headers.cookie || headers.Cookie || '';
  const out = {};
  for (const pair of raw.split(';')) {
    const i = pair.indexOf('=');
    if (i <= 0) continue;
    const key = pair.slice(0, i).trim();
    const value = pair.slice(i + 1).trim();
    out[key] = value;
  }
  return out;
}

export function getSessionFromHeaders(headers = {}) {
  const cookies = parseCookies(headers);
  const token = cookies[SESSION_COOKIE];
  return verifySessionToken(token);
}

export function getAuthenticatedAdmin(headers = {}) {
  const session = getSessionFromHeaders(headers);
  if (!session) return null;
  return { username: session.sub, exp: session.exp };
}

export function makeSessionCookie(token) {
  const maxAge = Number(process.env.ADMIN_SESSION_TTL_SECONDS || 8 * 60 * 60);
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    `Max-Age=${maxAge}`,
    'HttpOnly',
    'SameSite=Strict',
    'Secure',
  ];
  return parts.join('; ');
}

export function clearSessionCookie() {
  return [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Strict',
    'Secure',
  ].join('; ');
}
