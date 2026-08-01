import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, fetchMock, SELF } from 'cloudflare:test';
import { handleImageFile } from '../src/routes/image-file';
import type { Env } from '../src/helpers';

const imageEnv = {
  DB: env.DB,
  ADMIN_PASSWORD: 'test-password',
  CORS_ORIGIN: '*',
  GITHUB_TOKEN: 'test-token',
  GITHUB_REPO: 'testowner/testrepo',
  GITHUB_BRANCH: 'master',
  ADMIN_GITHUB_WRITE_MODE: 'commit',
} as unknown as Env;

const BASE = 'http://localhost';

// 20x20 solid-red PNG (84 bytes) — reused as "valid test image bytes". The
// route just streams whatever GitHub returns, so any byte buffer works; a
// recognizable image is only used for readability.
const RED_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAIAAAAC64paAAAAG0lEQVR4nGP4z8BANiJf56jmUc2jmkc1U0UzADHNjoAymaoJAAAAAElFTkSuQmCC';
const PNG_BYTES = Buffer.from(RED_PNG_B64, 'base64');
const WEBP_BYTES = Buffer.from('fake-webp-bytes-for-test');

// ── Mutable state consulted by persisted interceptors ──────────────────────
type HandlerFn = () => { statusCode: number; data: any };

let imagesGetHandler: HandlerFn;
// Counts requests that legitimately match `public/images/**`.
let legitCallCount = 0;
// Counts any GitHub API call that did NOT match the `public/images/**`
// predicate — if path validation ever has a bug that lets an escaped path
// reach getRepoRawFile, it would land here instead of silently succeeding.
let escapedCallCount = 0;

function defaultImagesGet(): { statusCode: number; data: any } {
  return { statusCode: 404, data: { message: 'Not Found' } };
}

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();

  const gh = fetchMock.get('https://api.github.com');

  // Legitimate images path — matches what handleImageFile is expected to
  // request: /repos/{owner}/{repo}/contents/public/images/**
  gh.intercept({
    method: 'GET',
    path: (p) => p.includes('/contents/public/images/'),
  })
    .reply(() => {
      legitCallCount += 1;
      return imagesGetHandler();
    })
    .persist();

  // Catch-all: any other GitHub Contents API call (e.g. one that escaped the
  // `public/images/` prefix) lands here instead of silently succeeding.
  gh.intercept({
    method: 'GET',
    path: () => true,
  })
    .reply(() => {
      escapedCallCount += 1;
      return { statusCode: 404, data: { message: 'Not Found (escaped path)' } };
    })
    .persist();
});

beforeEach(() => {
  imagesGetHandler = defaultImagesGet;
  legitCallCount = 0;
  escapedCallCount = 0;
});

describe('handleImageFile', () => {
  it('serves a png with the correct content-type', async () => {
    imagesGetHandler = () => ({
      statusCode: 200,
      data: PNG_BYTES,
      responseOptions: { headers: { 'content-type': 'application/octet-stream' } },
    });

    const res = await handleImageFile(imageEnv, 'jovylle.png');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Buffer.from(bytes).equals(PNG_BYTES)).toBe(true);
    expect(legitCallCount).toBe(1);
    expect(escapedCallCount).toBe(0);
  });

  it('serves a nested webp with the correct content-type', async () => {
    imagesGetHandler = () => ({
      statusCode: 200,
      data: WEBP_BYTES,
    });

    const res = await handleImageFile(imageEnv, 'personal-projects/test-project.webp');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Buffer.from(bytes).equals(WEBP_BYTES)).toBe(true);
    expect(legitCallCount).toBe(1);
    expect(escapedCallCount).toBe(0);
  });

  it('returns 404 when the file does not exist', async () => {
    // imagesGetHandler stays defaultImagesGet → 404

    const res = await handleImageFile(imageEnv, 'personal-projects/missing.webp');

    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.error).toMatch(/not found/i);
    expect(legitCallCount).toBe(1);
    expect(escapedCallCount).toBe(0);
  });

  it('rejects a literal ".." path-traversal attempt without calling GitHub', async () => {
    const res = await handleImageFile(imageEnv, '../secret.png');

    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/invalid/i);
    expect(legitCallCount).toBe(0);
    expect(escapedCallCount).toBe(0);
  });

  it('rejects a nested ".." path-traversal attempt without calling GitHub', async () => {
    const res = await handleImageFile(imageEnv, 'personal-projects/../../secret.png');

    expect(res.status).toBe(400);
    expect(legitCallCount).toBe(0);
    expect(escapedCallCount).toBe(0);
  });

  it('rejects a percent-encoded ".." equivalent without calling GitHub', async () => {
    const res = await handleImageFile(imageEnv, '%2e%2e/secret.png');

    expect(res.status).toBe(400);
    expect(legitCallCount).toBe(0);
    expect(escapedCallCount).toBe(0);
  });

  it('rejects a leading-slash (absolute) path without calling GitHub', async () => {
    const res = await handleImageFile(imageEnv, '/etc/passwd.png');

    expect(res.status).toBe(400);
    expect(legitCallCount).toBe(0);
    expect(escapedCallCount).toBe(0);
  });

  it('rejects a backslash path without calling GitHub', async () => {
    const res = await handleImageFile(imageEnv, '..\\secret.png');

    expect(res.status).toBe(400);
    expect(legitCallCount).toBe(0);
    expect(escapedCallCount).toBe(0);
  });

  it('rejects a disallowed extension without calling GitHub', async () => {
    const res = await handleImageFile(imageEnv, 'personal-projects.json.enc');

    expect(res.status).toBe(400);
    expect(legitCallCount).toBe(0);
    expect(escapedCallCount).toBe(0);
  });

  it('rejects a path-traversal attempt at the real router/regex level', async () => {
    const res = await SELF.fetch(`${BASE}/images/../data/encrypted/personal-projects.json.enc`);
    expect(res.status).toBe(404);
  });
});
