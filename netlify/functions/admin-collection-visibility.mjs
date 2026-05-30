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
import { applyCollectionVisibilityUpdate } from './lib/visibility-mutators.mjs';

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
    key: `admin-collection-visibility:${ip}`,
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

  try {
    const { data, sha } = await readEncryptedJsonFile(
      'data/encrypted/publish-controls.json.enc',
      {
        collections: {
          'personal-projects': 'public',
          projects: 'public',
          highlights: 'public',
          profile: 'public',
          resume: 'public',
          blogs: 'public',
        },
      },
    );
    const controls = applyCollectionVisibilityUpdate(data, body);
    const write = await writeEncryptedJsonFile({
      filePath: 'data/encrypted/publish-controls.json.enc',
      data: controls,
      sha,
      actor: admin.username,
      branchHint: 'publish-controls',
      message:
        body.collection && body.status
          ? `admin: set collection ${body.collection}=${body.status}`
          : `admin: set collection personal-projects=${
              controls.collections?.['personal-projects'] || 'public'
            }`,
    });

    return jsonResponse(200, {
      ok: true,
      controls,
      write,
    });
  } catch (e) {
    if (e.message.includes('must be') || e.message.includes('required')) {
      return badRequest(e.message);
    }
    return serverError(e.message);
  }
}
