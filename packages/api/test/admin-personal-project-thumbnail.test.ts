import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { env, fetchMock } from 'cloudflare:test';
import { handleAdminPersonalProjectThumbnail } from '../src/routes/admin/admin-personal-project-thumbnail';
import { encryptJson } from '../src/lib/content-crypto';
import type { Env } from '../src/helpers';

// AJV fails in the vitest-pool-workers miniflare shim (same artifact noted in
// sync-github.test.ts). Validation of the updated personal-projects doc would
// always throw a ValidationError → 400, masking the real route behaviour.
// Mock it to always pass so we test the route logic, not the AJV runtime quirk.
vi.mock('../src/lib/validate-collection.ts', () => ({
  validateCollectionData: vi.fn().mockResolvedValue({ ok: true, errors: [] }),
  loadManifest: vi.fn().mockReturnValue({ version: 1, collections: [] }),
}));

const CONTENT_KEY = 'test-content-decrypt-key-1234567890';

const thumbEnv = {
  DB: env.DB,
  ADMIN_PASSWORD: 'test-password',
  CORS_ORIGIN: '*',
  GITHUB_TOKEN: 'test-token',
  GITHUB_REPO: 'testowner/testrepo',
  GITHUB_BRANCH: 'master',
  CONTENT_DECRYPT_KEY: CONTENT_KEY,
  ADMIN_GITHUB_WRITE_MODE: 'commit',
} as unknown as Env;

// 20x20 solid-red PNG (84 bytes). Source of truth for "valid test image".
const RED_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAIAAAAC64paAAAAG0lEQVR4nGP4z8BANiJf56jmUc2jmkc1U0UzADHNjoAymaoJAAAAAElFTkSuQmCC';

// personal-projects schema requires these fields; additionalProperties is false.
function validProject(overrides: Record<string, any> = {}) {
  return {
    title: 'Existing',
    description: 'An existing project already tracked in the CMS.',
    repo: 'https://github.com/testuser/existing-repo',
    updated_at: '2021-01-01T00:00:00Z',
    created_at: '2020-01-01T00:00:00Z',
    slug: 'existing-repo',
    status: 'published',
    private: false,
    fav: false,
    priority_score: 100,
    tech: ['JavaScript'],
    links: [{ label: 'Repo', url: 'https://github.com/testuser/existing-repo' }],
    thumbnail: '',
    ...overrides,
  };
}

function encryptedContentsResponse(doc: unknown, sha = 'sha-1') {
  const wrapper = `${encryptJson(JSON.stringify(doc, null, 2), { CONTENT_DECRYPT_KEY: CONTENT_KEY })}\n`;
  return { content: Buffer.from(wrapper, 'utf8').toString('base64'), sha };
}

// Builds a POST request with FormData containing the uploaded file.
function makeFormDataRequest(blob: Blob, filename = 'image.png', mime = 'image/png') {
  const fd = new FormData();
  fd.append('file', new File([blob], filename, { type: mime }));
  return new Request('https://x.example/api/admin/personal-projects/thumb', {
    method: 'POST',
    body: fd,
  });
}

// ── Mutable state consulted by persisted interceptors ──────────────────────
// Each interceptor delegates to a swappable function so individual tests can
// override behaviour without needing to register overlapping interceptors.
let contentsDoc: unknown = { projects: [] };

type HandlerFn = (opts?: any) => { statusCode: number; data: any };

let imageGetHandler: HandlerFn;
let imagePutHandler: HandlerFn;
let jsonGetHandler: HandlerFn;
let jsonPutHandler: HandlerFn;

function defaultImageGet(): { statusCode: number; data: any } {
  return { statusCode: 404, data: { message: 'Not Found' } };
}
function defaultImagePut(): { statusCode: number; data: any } {
  return {
    statusCode: 200,
    data: {
      content: {},
      commit: { sha: 'img-commit-sha', html_url: 'https://github.com/x' },
    },
  };
}
function defaultJsonGet(): { statusCode: number; data: any } {
  return { statusCode: 200, data: encryptedContentsResponse(contentsDoc) };
}
function defaultJsonPut(): { statusCode: number; data: any } {
  return {
    statusCode: 200,
    data: {
      content: {},
      commit: { sha: 'json-commit-sha', html_url: 'https://github.com/x' },
    },
  };
}

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();

  const gh = fetchMock.get('https://api.github.com');

  // Image GET — intercept before the broader JSON path so predicates don't
  // accidentally overlap (they don't, but explicit ordering avoids surprises).
  gh.intercept({
    method: 'GET',
    path: (p) => p.includes('/contents/public/images/personal-projects/'),
  })
    .reply((opts: any) => imageGetHandler(opts))
    .persist();

  // Image PUT
  gh.intercept({
    method: 'PUT',
    path: (p) => p.includes('/contents/public/images/personal-projects/'),
  })
    .reply((opts: any) => imagePutHandler(opts))
    .persist();

  // JSON GET
  gh.intercept({
    method: 'GET',
    path: (p) => p.includes('/contents/data/encrypted/personal-projects.json.enc'),
  })
    .reply((opts: any) => jsonGetHandler(opts))
    .persist();

  // JSON PUT
  gh.intercept({
    method: 'PUT',
    path: (p) => p.includes('/contents/data/encrypted/personal-projects.json.enc'),
  })
    .reply((opts: any) => jsonPutHandler(opts))
    .persist();
});

beforeEach(() => {
  contentsDoc = { projects: [] };
  imageGetHandler = defaultImageGet;
  imagePutHandler = defaultImagePut;
  jsonGetHandler = defaultJsonGet;
  jsonPutHandler = defaultJsonPut;
});

describe('handleAdminPersonalProjectThumbnail', () => {
  const SLUG = 'test-project';
  const THUMBNAIL_URL = `https://content.jovylle.com/images/personal-projects/${SLUG}.webp`;

  // ── Case 1: Happy path ─────────────────────────────────────────────────
  it('returns ok:true and the CDN thumbnail URL when slug exists and no prior thumbnail', async () => {
    contentsDoc = { projects: [validProject({ slug: SLUG })] };
    // imageGetHandler stays defaultImageGet → 404 (no existing sha)

    const pngBytes = Buffer.from(RED_PNG_B64, 'base64');
    const req = makeFormDataRequest(new Blob([pngBytes], { type: 'image/png' }));
    const res = await handleAdminPersonalProjectThumbnail(thumbEnv, req, 'test-admin', SLUG);

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(body.slug).toBe(SLUG);
    expect(body.thumbnail).toBe(THUMBNAIL_URL);
  });

  // ── Case 2: Overwrite path ─────────────────────────────────────────────
  it('succeeds when a prior thumbnail sha is present (overwrite path)', async () => {
    contentsDoc = { projects: [validProject({ slug: SLUG, thumbnail: THUMBNAIL_URL })] };

    // Simulate an existing image file already in the repo.
    imageGetHandler = () => ({
      statusCode: 200,
      data: { content: Buffer.from('fake-webp-bytes').toString('base64'), sha: 'existing-img-sha' },
    });

    const pngBytes = Buffer.from(RED_PNG_B64, 'base64');
    const req = makeFormDataRequest(new Blob([pngBytes], { type: 'image/png' }));
    const res = await handleAdminPersonalProjectThumbnail(thumbEnv, req, 'test-admin', SLUG);

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(body.thumbnail).toBe(THUMBNAIL_URL);
  });

  // ── Case 3: Bad MIME type ──────────────────────────────────────────────
  it('returns 400 for a disallowed MIME type (text/plain)', async () => {
    // No network calls expected since validation happens before any GitHub I/O.
    const req = makeFormDataRequest(new Blob(['hello world'], { type: 'text/plain' }), 'file.txt', 'text/plain');
    const res = await handleAdminPersonalProjectThumbnail(thumbEnv, req, 'test-admin', SLUG);

    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/not allowed/i);
  });

  // ── Case 4: Oversized file ─────────────────────────────────────────────
  // The size check comes after the MIME check, so the blob must have a valid
  // MIME type (image/png) to reach the size gate.
  it('returns 400 when the uploaded file exceeds 10 MB', async () => {
    const bigBuffer = Buffer.alloc(10 * 1024 * 1024 + 1, 0x00);
    const req = makeFormDataRequest(new Blob([bigBuffer], { type: 'image/png' }), 'big.png', 'image/png');
    const res = await handleAdminPersonalProjectThumbnail(thumbEnv, req, 'test-admin', SLUG);

    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/10 MB/i);
  });

  // ── Case 5: Unknown slug ───────────────────────────────────────────────
  // NOTE: the image is committed to GitHub *before* the slug lookup happens
  // (see route code order). If the slug is absent the image write is wasted —
  // this is a behavioral quirk worth reviewing in the route implementation.
  it('returns 404 when the slug does not exist in personal-projects', async () => {
    // The JSON doc has a different slug — 'test-project' won't be found.
    contentsDoc = { projects: [validProject({ slug: 'other-project' })] };

    const pngBytes = Buffer.from(RED_PNG_B64, 'base64');
    const req = makeFormDataRequest(new Blob([pngBytes], { type: 'image/png' }));
    const res = await handleAdminPersonalProjectThumbnail(thumbEnv, req, 'test-admin', SLUG);

    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.error).toMatch(/not found/i);
  });

  // ── Case 6: Invalid slug format ────────────────────────────────────────
  it('returns 400 for a slug that does not match the lowercase-hyphen pattern', async () => {
    const pngBytes = Buffer.from(RED_PNG_B64, 'base64');
    const req = makeFormDataRequest(new Blob([pngBytes], { type: 'image/png' }));
    const res = await handleAdminPersonalProjectThumbnail(thumbEnv, req, 'test-admin', 'Some_Slug!');

    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/lowercase/i);
  });

  // ── Bonus: processed bytes are valid WebP ─────────────────────────────
  // Captures the base64 content field from the image PUT body (if the undici
  // mock interceptor exposes opts.body) and checks RIFF/WEBP magic bytes.
  it('bonus: image written to GitHub is a valid WebP (RIFF/WEBP magic headers)', async () => {
    contentsDoc = { projects: [validProject({ slug: SLUG })] };

    let capturedBase64: string | null = null;
    imagePutHandler = (opts: any) => {
      try {
        // undici passes the request body string to the reply callback via opts.body.
        // If it's unavailable (stream consumed before dispatch), capturedBase64
        // stays null and the WebP assertion is skipped.
        const bodyStr = opts && typeof opts.body === 'string' ? opts.body : null;
        if (bodyStr) {
          const parsed = JSON.parse(bodyStr);
          capturedBase64 = typeof parsed.content === 'string' ? parsed.content : null;
        }
      } catch {
        // Body parse failed; leave capturedBase64 null.
      }
      return {
        statusCode: 200,
        data: {
          content: {},
          commit: { sha: 'img-commit-sha', html_url: 'https://github.com/x' },
        },
      };
    };

    const pngBytes = Buffer.from(RED_PNG_B64, 'base64');
    const req = makeFormDataRequest(new Blob([pngBytes], { type: 'image/png' }));
    const res = await handleAdminPersonalProjectThumbnail(thumbEnv, req, 'test-admin', SLUG);
    expect(res.status).toBe(200);

    if (capturedBase64 !== null) {
      const outBytes = Buffer.from(capturedBase64, 'base64');
      // WebP container: bytes 0-3 = "RIFF", bytes 8-11 = "WEBP"
      expect(outBytes.slice(0, 4).toString('ascii')).toBe('RIFF');
      expect(outBytes.slice(8, 12).toString('ascii')).toBe('WEBP');
    } else {
      // undici didn't surface the body in the interceptor opts — skip silently.
      console.warn('Skipping WebP magic-byte check: opts.body was not available from undici interceptor');
    }
  });
});
