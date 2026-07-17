import {
  getAuthenticatedAdmin,
  getAuthenticatedIngestToken,
  isCollectionAllowedForToken,
} from './lib/admin-auth.mjs';
import { readEncryptedJsonFile, writeEncryptedJsonFile } from './lib/encrypted-content-store.mjs';
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

const BLOGS_DIR = 'data/encrypted/blogs';
const COLLECTION_KEY = 'blogs';

function authenticateRequest(headers) {
  const admin = getAuthenticatedAdmin(headers);
  if (admin) return { actor: admin.username, writeMode: undefined };

  const token = getAuthenticatedIngestToken(headers);
  if (token) {
    if (!isCollectionAllowedForToken(token, COLLECTION_KEY)) {
      return { error: forbidden(`Token not permitted for collection: ${COLLECTION_KEY}`) };
    }
    // Token-authenticated writes default to a PR, regardless of
    // ADMIN_GITHUB_WRITE_MODE, since ingest tokens are a less-trusted caller;
    // a token may opt into direct-to-master commits via the optional
    // writeMode field in INGEST_TOKENS (see admin-auth.mjs).
    return { actor: `ingest:${token.tokenId}`, writeMode: token.writeMode };
  }

  return { error: unauthorized() };
}

function clientIp(headers = {}) {
  const forwarded = headers['x-forwarded-for'] || headers['X-Forwarded-For'];
  if (!forwarded) return 'unknown';
  return String(forwarded).split(',')[0].trim();
}

function slugFromQuery(event) {
  const qs = event.queryStringParameters || {};
  return String(qs.slug || qs.key || '').trim();
}

function blogFilePath(slug) {
  const safe = String(slug || '').trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(safe)) {
    throw new Error('slug must be lowercase letters, numbers, and hyphens');
  }
  return `${BLOGS_DIR}/${safe}.json.enc`;
}

export async function handler(event) {
  try {
    return await handleAdminBlogFile(event);
  } catch (e) {
    console.error('admin-blog-file:', e);
    return serverError(e?.message || 'Internal server error');
  }
}

async function handleAdminBlogFile(event) {
  const auth = authenticateRequest(event.headers);
  if (auth.error) return auth.error;
  const { actor, writeMode } = auth;

  if (event.httpMethod === 'GET') {
    try {
      const slug = slugFromQuery(event);
      if (!slug) return badRequest('slug is required');
      const filePath = blogFilePath(slug);
      const file = await readEncryptedJsonFile(filePath, null);
      if (!file.exists) {
        return jsonResponse(404, { error: 'Blog post not found', slug });
      }
      return jsonResponse(200, {
        ok: true,
        slug,
        data: file.data,
      });
    } catch (e) {
      if (e.message.includes('slug must be')) return badRequest(e.message);
      return serverError(e.message);
    }
  }

  if (event.httpMethod === 'POST') {
    const ip = clientIp(event.headers);
    const limit = consumeRateLimit({
      key: `admin-blog-file:${ip}`,
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
      const slug = String(body.slug || '').trim();
      if (!slug) return badRequest('slug is required');
      if (body.data === undefined) return badRequest('data is required');

      const filePath = blogFilePath(slug);
      if (body.data.slug && body.data.slug !== slug) {
        return badRequest('data.slug must match slug in request');
      }
      body.data.slug = slug;

      const { validateCollectionData } = await import('./lib/validate-collection.mjs');
      const validation = await validateCollectionData('blog-post', body.data);
      if (!validation.ok) {
        return jsonResponse(400, {
          error: 'Validation failed',
          validationErrors: validation.errors,
        });
      }

      const existing = await readEncryptedJsonFile(filePath, null);
      const write = await writeEncryptedJsonFile({
        filePath,
        data: body.data,
        sha: existing.sha,
        actor,
        branchHint: `blog-${slug}`,
        message: `admin: update blog ${slug}`,
        writeMode,
      });

      return jsonResponse(200, {
        ok: true,
        slug,
        write,
      });
    } catch (e) {
      if (e.message.includes('slug must be')) return badRequest(e.message);
      return serverError(e.message);
    }
  }

  if (event.httpMethod === 'DELETE') {
    const ip = clientIp(event.headers);
    const limit = consumeRateLimit({
      key: `admin-blog-file-delete:${ip}`,
      windowMs: 60_000,
      maxRequests: 15,
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
      const slug = String(body.slug || slugFromQuery(event)).trim();
      if (!slug) return badRequest('slug is required');
      const filePath = blogFilePath(slug);
      const existing = await readEncryptedJsonFile(filePath, null);
      if (!existing.exists) return badRequest(`Blog post not found: ${slug}`);

      const { deleteRepoFile } = await import('./lib/github-content.mjs');
      const write = await deleteRepoFile({
        filePath,
        sha: existing.sha,
        message: `admin: delete blog ${slug}`,
        actor,
        branchHint: `blog-delete-${slug}`,
        writeMode,
      });

      return jsonResponse(200, { ok: true, slug, write });
    } catch (e) {
      if (e.message.includes('slug must be') || e.message.includes('not found')) {
        return badRequest(e.message);
      }
      return serverError(e.message);
    }
  }

  return methodNotAllowed('GET, POST, DELETE');
}
