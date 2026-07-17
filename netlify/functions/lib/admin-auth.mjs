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

export function verifyAdminPassword(password) {
  if (typeof password !== 'string' || password.length === 0) return false;

  const plain = process.env.ADMIN_PASSWORD || '';
  if (plain) {
    if (plain.length !== password.length) return false;
    return crypto.timingSafeEqual(Buffer.from(password), Buffer.from(plain));
  }

  const encoded = process.env.ADMIN_PASSWORD_HASH || '';
  if (!encoded) {
    throw new Error('Set ADMIN_PASSWORD (preferred) or ADMIN_PASSWORD_HASH.');
  }

  const parts = encoded.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    throw new Error(
      'ADMIN_PASSWORD_HASH format must be scrypt$<saltB64>$<hashB64>.',
    );
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

/**
 * Bearer-token auth for non-interactive callers (scripts/webhooks), kept in a
 * completely separate secret space from ADMIN_PASSWORD/ADMIN_SESSION_SECRET so
 * revoking one token never touches the human session or other tokens.
 *
 * INGEST_TOKENS format: comma-separated entries of
 *   tokenId:secretToken:collectionKey1|collectionKey2|...:writeMode
 * e.g. INGEST_TOKENS="ci-blogs:s3cr3t-abc:blogs,ci-notify:s3cr3t-xyz:notifications|blogs"
 * Collection keys must match EDITABLE_COLLECTIONS keys in admin-collections.mjs.
 *
 * The trailing `writeMode` field is optional and defaults to `'pr'` when
 * omitted, so existing entries keep working unchanged. Set it to `'commit'`
 * to let that specific token write straight to master instead of opening a
 * PR — e.g. INGEST_TOKENS="ci-fast-scores:s3cr3t-fast:fast-scores:commit".
 * Any other value (or omission) falls back to `'pr'`.
 */
function parseIngestTokens() {
  const raw = process.env.INGEST_TOKENS || '';
  const entries = [];
  for (const chunk of raw.split(',')) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const [tokenId, secret, collectionsText, writeModeText] = trimmed.split(':');
    if (!tokenId || !secret || !collectionsText) continue;
    const collections = collectionsText
      .split('|')
      .map((c) => c.trim())
      .filter(Boolean);
    if (collections.length === 0) continue;
    const writeMode = writeModeText?.trim() === 'commit' ? 'commit' : 'pr';
    entries.push({ tokenId: tokenId.trim(), secret: secret.trim(), collections, writeMode });
  }
  return entries;
}

export function getAuthenticatedIngestToken(headers = {}) {
  const raw = headers.authorization || headers.Authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(String(raw).trim());
  if (!match) return null;
  const presented = match[1].trim();
  if (!presented) return null;

  for (const entry of parseIngestTokens()) {
    if (entry.secret.length !== presented.length) continue;
    if (!crypto.timingSafeEqual(Buffer.from(entry.secret), Buffer.from(presented))) continue;
    return { tokenId: entry.tokenId, allowedCollections: entry.collections, writeMode: entry.writeMode };
  }
  return null;
}

export function isCollectionAllowedForToken(token, collectionKey) {
  return Boolean(token?.allowedCollections?.includes(collectionKey));
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
