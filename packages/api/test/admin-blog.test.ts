import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { env, fetchMock, SELF } from 'cloudflare:test';
import { handleAdminBlogGet, handleAdminBlogPost } from '../src/routes/admin/admin-blog';
import { encryptJson, decryptJson } from '../src/lib/content-crypto';
import { validateCollectionData } from '../src/lib/validate-collection';
import type { Env } from '../src/helpers';

// AJV fails in the vitest-pool-workers miniflare shim for every collection
// (same artifact noted in admin-personal-project-thumbnail.test.ts), so schema
// validation would always return ERROR → 400 and mask the route behaviour.
// The mock tests route logic; the blog-post schema itself is checked separately.
vi.mock('../src/lib/validate-collection.ts', () => ({
  validateCollectionData: vi.fn().mockResolvedValue({ ok: true, errors: [] }),
  loadManifest: vi.fn().mockReturnValue({ version: 1, collections: [] }),
}));

const CONTENT_KEY = 'test-content-decrypt-key-1234567890';

const blogEnv = {
  DB: env.DB,
  ADMIN_PASSWORD: 'test-password',
  CORS_ORIGIN: '*',
  GITHUB_TOKEN: 'test-token',
  GITHUB_REPO: 'testowner/testrepo',
  GITHUB_BRANCH: 'master',
  CONTENT_DECRYPT_KEY: CONTENT_KEY,
  ADMIN_GITHUB_WRITE_MODE: 'commit',
} as unknown as Env;

const CONTENTS_PREFIX = '/repos/testowner/testrepo/contents/data/encrypted/blogs/';

function encryptedContentsResponse(doc: unknown, sha = 'sha-1') {
  const wrapper = `${encryptJson(JSON.stringify(doc, null, 2), { CONTENT_DECRYPT_KEY: CONTENT_KEY })}\n`;
  return { content: Buffer.from(wrapper, 'utf8').toString('base64'), sha };
}

// ── Mutable network state consulted by persisted interceptors ──
let getHandler: (path: string) => { statusCode: number; data: any } = () => notFound();
let putCalls: Array<Record<string, any>> = [];

function notFound() {
  return { statusCode: 404, data: { message: 'Not Found' } };
}

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();

  const gh = fetchMock.get('https://api.github.com');
  gh.intercept({ method: 'GET', path: (p) => p.startsWith(CONTENTS_PREFIX) })
    .reply((opts) => getHandler(String(opts.path)))
    .persist();
  gh.intercept({ method: 'PUT', path: (p) => p.startsWith(CONTENTS_PREFIX) })
    .reply((opts) => {
      putCalls.push(JSON.parse(String(opts.body)));
      return {
        statusCode: 200,
        data: {
          content: {},
          commit: { sha: 'commit-sha-1', html_url: 'https://github.com/testowner/testrepo/commit/commit-sha-1' },
        },
      };
    })
    .persist();
});

beforeEach(() => {
  getHandler = () => notFound();
  putCalls = [];
});

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/admin/blogs/unused', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const post = (body: unknown) => handleAdminBlogPost(blogEnv, jsonRequest(body), 'admin');

describe('admin blog create (POST /api/admin/blogs/:slug)', () => {
  it('creates a new slug: PUT without sha, returns 200', async () => {
    getHandler = () => notFound();

    const res = await post({ slug: 'new-post', data: { title: 'New post', status: 'draft' } });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, slug: 'new-post' });
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0]).not.toHaveProperty('sha');
    expect(putCalls[0].branch).toBe('master');

    // The committed ciphertext decrypts to the saved document with the slug set.
    const wrapper = Buffer.from(putCalls[0].content, 'base64').toString('utf8');
    const saved = JSON.parse(decryptJson(wrapper.trim(), blogEnv));
    expect(saved).toMatchObject({ slug: 'new-post', title: 'New post', status: 'draft' });
  });

  it('updates an existing slug: forwards the current sha', async () => {
    getHandler = () => ({
      statusCode: 200,
      data: encryptedContentsResponse({ slug: 'old-post', title: 'Old title' }, 'sha-existing'),
    });

    const res = await post({ slug: 'old-post', data: { title: 'Updated title' } });

    expect(res.status).toBe(200);
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0].sha).toBe('sha-existing');
  });

  it('rejects an invalid slug with 400 and writes nothing', async () => {
    const res = await post({ slug: 'Bad Slug!', data: { title: 'x' } });

    expect(res.status).toBe(400);
    expect(putCalls).toHaveLength(0);
  });

  it('rejects a body.slug mismatch with 400 and writes nothing', async () => {
    const res = await post({ slug: 'alpha-post', data: { slug: 'beta-post', title: 'x' } });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'data.slug must match slug in request' });
    expect(putCalls).toHaveLength(0);
  });

  it('returns 400 and writes nothing when schema validation fails', async () => {
    vi.mocked(validateCollectionData).mockResolvedValueOnce({
      ok: false,
      errors: ['FAIL blog-post: schema validation', '  - /status must be equal to one of the allowed values'],
    });

    const res = await post({ slug: 'odd-post', data: { title: 'Odd', status: 'archived' } });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'Validation failed' });
    expect(putCalls).toHaveLength(0);
  });
});

describe('admin blog read (GET /api/admin/blogs/:slug)', () => {
  it('returns 404 for a missing slug', async () => {
    getHandler = () => notFound();

    const res = await handleAdminBlogGet(blogEnv, 'missing-post');

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'Blog post not found', slug: 'missing-post' });
  });

  it('returns 200 with the decrypted data for an existing slug', async () => {
    getHandler = () => ({
      statusCode: 200,
      data: encryptedContentsResponse({ slug: 'real-post', title: 'Real' }, 'sha-real'),
    });

    const res = await handleAdminBlogGet(blogEnv, 'real-post');

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      slug: 'real-post',
      data: { slug: 'real-post', title: 'Real' },
    });
  });
});

describe('admin blog auth', () => {
  it('returns 401 without credentials', async () => {
    const res = await SELF.fetch('http://localhost/api/admin/blogs/new-post', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'new-post', data: { title: 'x' } }),
    });

    expect(res.status).toBe(401);
    expect(putCalls).toHaveLength(0);
  });
});
