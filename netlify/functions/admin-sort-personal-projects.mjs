import { getAuthenticatedAdmin } from './lib/admin-auth.mjs';
import { readEncryptedJsonFile, writeEncryptedJsonFile } from './lib/encrypted-content-store.mjs';
import { fetchRepoCreatedAt } from './lib/github-repo-meta.mjs';
import {
  badRequest,
  jsonResponse,
  methodNotAllowed,
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
  const admin = getAuthenticatedAdmin(event.headers);
  if (!admin) return unauthorized();

  const ip = clientIp(event.headers);
  const limit = consumeRateLimit({
    key: `admin-sort-personal-projects:${ip}`,
    windowMs: 60_000,
    maxRequests: 5,
  });
  if (!limit.ok) {
    return jsonResponse(
      429,
      { error: 'Too many requests' },
      { 'retry-after': String(limit.retryAfterSeconds) },
    );
  }

  try {
    const { data, sha } = await readEncryptedJsonFile('data/encrypted/personal-projects.json.enc');
    if (!Array.isArray(data?.projects)) {
      return badRequest('personal-projects.json must contain projects array');
    }

    const cache = new Map();
    const projects = [...data.projects];

    const withCreated = await Promise.all(
      projects.map(async (project) => {
        const repoUrl = project?.repo || '';
        if (!cache.has(repoUrl)) {
          cache.set(repoUrl, fetchRepoCreatedAt(repoUrl).catch(() => null));
        }
        const createdAt = await cache.get(repoUrl);
        return {
          ...project,
          __repo_created_at: createdAt || null,
        };
      }),
    );

    withCreated.sort((a, b) => {
      const aTime = a.__repo_created_at || '';
      const bTime = b.__repo_created_at || '';
      if (aTime && bTime) return bTime.localeCompare(aTime);
      if (aTime) return -1;
      if (bTime) return 1;
      return (b.updated_at || '').localeCompare(a.updated_at || '');
    });

    const cleaned = withCreated.map((project) => {
      const out = { ...project };
      delete out.__repo_created_at;
      return out;
    });

    const write = await writeEncryptedJsonFile({
      filePath: 'data/encrypted/personal-projects.json.enc',
      data: { ...data, projects: cleaned },
      sha,
      actor: admin.username,
      branchHint: 'personal-projects-created-sort',
      message: 'admin: sort personal projects by repo creation date',
    });

    return jsonResponse(200, {
      ok: true,
      sortedCount: cleaned.length,
      write,
    });
  } catch (e) {
    return serverError(e.message);
  }
}
