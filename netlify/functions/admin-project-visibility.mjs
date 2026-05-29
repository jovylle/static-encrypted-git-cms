import { getAuthenticatedAdmin } from './lib/admin-auth.mjs';
import { readEncryptedJsonFile, writeEncryptedJsonFile } from './lib/encrypted-content-store.mjs';
import {
  badRequest,
  jsonResponse,
  methodNotAllowed,
  parseJsonBody,
  serverError,
  unauthorized,
} from './lib/http.mjs';
import { consumeRateLimit } from './lib/rate-limit.mjs';
import { applyProjectVisibilityUpdate } from './lib/visibility-mutators.mjs';

function clientIp(headers = {}) {
  const forwarded = headers['x-forwarded-for'] || headers['X-Forwarded-For'];
  if (!forwarded) return 'unknown';
  return String(forwarded).split(',')[0].trim();
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return methodNotAllowed('POST');

  const admin = getAuthenticatedAdmin(event.headers);
  if (!admin) return unauthorized();

  const ip = clientIp(event.headers);
  const limit = consumeRateLimit({
    key: `admin-project-visibility:${ip}`,
    windowMs: 60_000,
    maxRequests: 60,
  });
  if (!limit.ok) {
    return jsonResponse(
      429,
      { error: 'Too many requests' },
      { 'retry-after': String(limit.retryAfterSeconds) },
    );
  }

  let body;
  try {
    body = parseJsonBody(event);
  } catch (e) {
    return badRequest(e.message);
  }

  if (body.status === undefined && body.private === undefined) {
    return badRequest('At least one of status or private must be provided');
  }

  try {
    const { data, sha } = await readEncryptedJsonFile(
      'data/encrypted/personal-projects.json.enc',
    );
    const updated = applyProjectVisibilityUpdate(data, body);
    const write = await writeEncryptedJsonFile({
      filePath: 'data/encrypted/personal-projects.json.enc',
      data,
      sha,
      actor: admin.username,
      branchHint: updated.slug || 'project',
      message: `admin: update personal project visibility (${updated.slug})`,
    });

    return jsonResponse(200, {
      ok: true,
      project: {
        slug: updated.slug,
        status: updated.status,
        private: updated.private,
      },
      write,
    });
  } catch (e) {
    if (
      e.message.includes('required') ||
      e.message.includes('must be') ||
      e.message.includes('not found')
    ) {
      return badRequest(e.message);
    }
    return serverError(e.message);
  }
}
