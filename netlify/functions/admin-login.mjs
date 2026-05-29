import {
  createSessionToken,
  makeSessionCookie,
  verifyAdminPassword,
} from './lib/admin-auth.mjs';
import {
  badRequest,
  jsonResponse,
  methodNotAllowed,
  parseJsonBody,
  serverError,
  unauthorized,
} from './lib/http.mjs';
import { consumeRateLimit } from './lib/rate-limit.mjs';

function clientIp(headers = {}) {
  const forwarded = headers['x-forwarded-for'] || headers['X-Forwarded-For'];
  if (!forwarded) return 'unknown';
  return String(forwarded).split(',')[0].trim();
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return methodNotAllowed('POST');

  const ip = clientIp(event.headers);
  const limit = consumeRateLimit({
    key: `admin-login:${ip}`,
    windowMs: 60_000,
    maxRequests: 10,
  });
  if (!limit.ok) {
    return jsonResponse(
      429,
      { error: 'Too many login attempts' },
      { 'retry-after': String(limit.retryAfterSeconds) },
    );
  }

  let body;
  try {
    body = parseJsonBody(event);
  } catch (e) {
    return badRequest(e.message);
  }

  const password = body.password;
  if (typeof password !== 'string' || password.length === 0) {
    return badRequest('password is required');
  }

  try {
    const ok = verifyAdminPassword(password);
    if (!ok) return unauthorized('Invalid credentials');
    const token = createSessionToken('admin');
    return jsonResponse(
      200,
      { ok: true },
      { 'set-cookie': makeSessionCookie(token) },
    );
  } catch (e) {
    return serverError(e.message);
  }
}
