import { getAuthenticatedAdmin } from './lib/admin-auth.mjs';
import { defaultDataForCollection, getAdminCollectionByKey } from './lib/admin-collections.mjs';
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

function clientIp(headers = {}) {
  const forwarded = headers['x-forwarded-for'] || headers['X-Forwarded-For'];
  if (!forwarded) return 'unknown';
  return String(forwarded).split(',')[0].trim();
}

function getCollectionKeyFromQuery(event) {
  const qs = event.queryStringParameters || {};
  return qs.collection || qs.key || '';
}

function ensureAllowedCollection(key) {
  const collection = getAdminCollectionByKey(key);
  if (!collection) throw new Error('Unknown collection');
  if (collection.multiFile) throw new Error('Use the blog or notification bundle API for this collection');
  return collection;
}

export async function handler(event) {
  try {
    return await handleAdminJsonFile(event);
  } catch (e) {
    console.error('admin-json-file:', e);
    return serverError(e?.message || 'Internal server error');
  }
}

async function handleAdminJsonFile(event) {
  const admin = getAuthenticatedAdmin(event.headers);
  if (!admin) return unauthorized();

  if (event.httpMethod === 'GET') {
    try {
      const key = getCollectionKeyFromQuery(event);
      const collection = ensureAllowedCollection(key);
      const { data } = await readEncryptedJsonFile(
        collection.filePath,
        defaultDataForCollection(collection.key),
      );
      return jsonResponse(200, {
        ok: true,
        collection: { key: collection.key, label: collection.label },
        data,
      });
    } catch (e) {
      if (e.message.includes('Unknown collection')) return badRequest(e.message);
      return serverError(e.message);
    }
  }

  if (event.httpMethod === 'POST') {
    const ip = clientIp(event.headers);
    const limit = consumeRateLimit({
      key: `admin-json-file:${ip}`,
      windowMs: 60_000,
      maxRequests: 30,
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
      const collection = ensureAllowedCollection(body.collection || body.key);
      if (body.data === undefined) return badRequest('data is required');

      const { validateCollectionData } = await import('./lib/validate-collection.mjs');
      const validation = await validateCollectionData(collection.key, body.data);
      if (!validation.ok) {
        return jsonResponse(400, {
          error: 'Validation failed',
          validationErrors: validation.errors,
        });
      }

      const { sha } = await readEncryptedJsonFile(
        collection.filePath,
        defaultDataForCollection(collection.key),
      );
      const write = await writeEncryptedJsonFile({
        filePath: collection.filePath,
        data: body.data,
        sha,
        actor: admin.username,
        branchHint: `json-${collection.key}`,
        message: `admin: update ${collection.key}.json`,
      });

      return jsonResponse(200, {
        ok: true,
        collection: { key: collection.key, label: collection.label },
        write,
      });
    } catch (e) {
      if (e.message.includes('Unknown collection')) return badRequest(e.message);
      return serverError(e.message);
    }
  }

  return methodNotAllowed('GET, POST');
}
