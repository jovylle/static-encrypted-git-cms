import {
  getAuthenticatedAdmin,
  getAuthenticatedIngestToken,
  isCollectionAllowedForToken,
} from './lib/admin-auth.mjs';
import { defaultDataForCollection, getAdminCollectionByKey } from './lib/admin-collections.mjs';
import { readEncryptedJsonFile } from './lib/encrypted-content-store.mjs';
import {
  badRequest,
  forbidden,
  jsonResponse,
  methodNotAllowed,
  parseJsonBody,
  serverError,
  unauthorized,
} from './lib/http.mjs';
import { consumeRateLimit } from './lib/rate-limit.mjs';
import { readMergeWriteWithRetry } from './lib/read-merge-write.mjs';

// Collections that support the token-friendly `{ record }` single-record
// upsert/append POST mode, in addition to the session-cookie-only `{ data }`
// whole-document-replace mode. profile/resume/publish-controls are single
// objects (not arrays of records), so single-record mode doesn't apply there.
const SINGLE_RECORD_COLLECTIONS = new Set(['personal-projects', 'projects', 'highlights', 'fast-scores']);

// Append-only single-record collections have no unique key field on their
// array items, so there is no way to match an existing entry to update —
// every POST here adds a new array entry under `arrayKey`. Data-driven so
// adding a new append-only collection doesn't require a new `if` branch.
const APPEND_ONLY_COLLECTIONS = {
  highlights: { arrayKey: 'highlights' },
  'fast-scores': { arrayKey: 'scores' },
};

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

/**
 * Same pattern as admin-blog-file.mjs / admin-notification-file.mjs: try the
 * admin session cookie first, then fall back to a bearer ingest token scoped
 * to `collectionKey`. Unlike those single-collection endpoints, this one
 * serves several collections, so the allowed collection is a parameter
 * instead of a module-level constant. Token-authenticated writes default to
 * a PR (writeMode: 'pr'), regardless of ADMIN_GITHUB_WRITE_MODE, since ingest
 * tokens are a less-trusted caller; a token may opt into direct-to-master
 * commits via the optional writeMode field in INGEST_TOKENS (see
 * admin-auth.mjs).
 */
function authenticateRequest(headers, collectionKey) {
  const admin = getAuthenticatedAdmin(headers);
  if (admin) return { actor: admin.username, writeMode: undefined, isToken: false };

  const token = getAuthenticatedIngestToken(headers);
  if (token) {
    if (!isCollectionAllowedForToken(token, collectionKey)) {
      return { error: forbidden(`Token not permitted for collection: ${collectionKey}`) };
    }
    return { actor: `ingest:${token.tokenId}`, writeMode: token.writeMode, isToken: true };
  }

  return { error: unauthorized() };
}

/**
 * Build the mergeFn for the token-friendly single-record POST mode.
 * - personal-projects / projects: replace the matching array entry (by the
 *   schema's verified stable key: `slug` / `id`) if found, else append.
 * - APPEND_ONLY_COLLECTIONS entries (highlights, fast-scores): append-only.
 *   Their schemas have no unique key field on their items, so there is no
 *   way to match an existing entry to update — every call here adds a new
 *   array entry. Do not add update-by-key semantics for these without first
 *   adding a key field to the relevant schema.
 */
function buildSingleRecordMergeFn(collectionKey, record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('record must be an object');
  }

  if (collectionKey === 'personal-projects') {
    if (typeof record.slug !== 'string' || !record.slug) {
      throw new Error('record.slug is required for personal-projects');
    }
    return (current) => upsertArrayRecord(current, 'projects', record, (item) => item?.slug === record.slug);
  }

  if (collectionKey === 'projects') {
    if (typeof record.id !== 'number') {
      throw new Error('record.id is required for projects');
    }
    return (current) => upsertArrayRecord(current, 'projects', record, (item) => item?.id === record.id);
  }

  const appendOnly = APPEND_ONLY_COLLECTIONS[collectionKey];
  if (appendOnly) {
    const { arrayKey } = appendOnly;
    return (current) => {
      const doc = current || {};
      const items = Array.isArray(doc[arrayKey]) ? doc[arrayKey] : [];
      return { ...doc, [arrayKey]: [...items, record] };
    };
  }

  throw new Error(`Single-record mode not supported for collection: ${collectionKey}`);
}

function upsertArrayRecord(current, arrayKey, record, matchFn) {
  const doc = current || {};
  const items = Array.isArray(doc[arrayKey]) ? doc[arrayKey] : [];
  const index = items.findIndex(matchFn);
  const nextItems = index === -1 ? [...items, record] : items.map((item, i) => (i === index ? record : item));
  return { ...doc, [arrayKey]: nextItems };
}

/** Locate the upserted/appended record in the final written document, for the response. */
function describeWrittenRecord(collectionKey, mergedData, submittedRecord) {
  const appendOnly = APPEND_ONLY_COLLECTIONS[collectionKey];
  if (appendOnly) {
    const items = mergedData?.[appendOnly.arrayKey] || [];
    const index = items.length - 1;
    return { index, record: items[index] ?? null };
  }

  const items = mergedData?.projects || [];
  const matchFn =
    collectionKey === 'personal-projects'
      ? (item) => item?.slug === submittedRecord.slug
      : (item) => item?.id === submittedRecord.id;
  const index = items.findIndex(matchFn);
  return { index, record: index === -1 ? null : items[index] };
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
  if (event.httpMethod === 'GET') {
    const admin = getAuthenticatedAdmin(event.headers);
    if (!admin) return unauthorized();

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
      const auth = authenticateRequest(event.headers, collection.key);
      if (auth.error) return auth.error;
      const { actor, writeMode, isToken } = auth;

      if (body.record !== undefined) {
        if (!SINGLE_RECORD_COLLECTIONS.has(collection.key)) {
          return badRequest(`Single-record mode not supported for collection: ${collection.key}`);
        }

        let mergeFn;
        try {
          mergeFn = buildSingleRecordMergeFn(collection.key, body.record);
        } catch (e) {
          return badRequest(e.message);
        }

        const { data, write } = await readMergeWriteWithRetry({
          collectionKey: collection.key,
          filePath: collection.filePath,
          defaultValue: defaultDataForCollection(collection.key),
          mergeFn,
          actor,
          branchHint: `json-${collection.key}-record`,
          message: `admin: upsert ${collection.key} record`,
          writeMode,
        });

        return jsonResponse(200, {
          ok: true,
          collection: { key: collection.key, label: collection.label },
          record: describeWrittenRecord(collection.key, data, body.record),
          // Full merged document, so callers (e.g. ingest tokens) can compute
          // things like rank/leaderboard position locally without a second
          // round trip. Generic across all single-record collections.
          data,
          write,
        });
      }

      // Ingest tokens are restricted to the `{ record }` single-record mode
      // above; whole-document replace (`{ data }`) can silently drop or
      // overwrite unrelated entries in one call, so it stays reserved for
      // authenticated admin sessions. A token must never be able to replace
      // an entire collection file in one request.
      if (isToken) {
        return forbidden(
          'Ingest tokens may not replace an entire collection document; use { record } instead.',
        );
      }

      if (body.data === undefined) return badRequest('record or data is required');

      const { write } = await readMergeWriteWithRetry({
        collectionKey: collection.key,
        filePath: collection.filePath,
        defaultValue: defaultDataForCollection(collection.key),
        mergeFn: () => body.data,
        actor,
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
      if (e.validationErrors) {
        return jsonResponse(400, {
          error: 'Validation failed',
          validationErrors: e.validationErrors,
        });
      }
      return serverError(e.message);
    }
  }

  return methodNotAllowed('GET, POST');
}
