import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptJson } from '../scripts/lib/content-crypto.mjs';
import { createSessionToken } from '../netlify/functions/lib/admin-auth.mjs';
import { handler as jsonFileHandler } from '../netlify/functions/admin-json-file.mjs';

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = globalThis.fetch;

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
}

test.beforeEach(() => {
  process.env.CONTENT_DECRYPT_KEY = 'test-content-decrypt-key-0123456789';
  process.env.GITHUB_TOKEN = 'test-github-token';
  process.env.GITHUB_REPO = 'test-owner/test-repo';
  process.env.GITHUB_BRANCH = 'master';
  process.env.ADMIN_SESSION_SECRET = 'test-admin-session-secret-0123456789';
});

test.afterEach(() => {
  restoreEnv();
  globalThis.fetch = ORIGINAL_FETCH;
});

function encodeStoredFile(data) {
  const plaintext = JSON.stringify(data, null, 2);
  return `${encryptJson(plaintext)}\n`;
}

/** Minimal in-memory fake of the GitHub contents/refs/pulls API used by github-content.mjs. */
function installGithubMock(initialFiles = {}) {
  const files = new Map();
  for (const [filePath, data] of Object.entries(initialFiles)) {
    files.set(filePath, { content: encodeStoredFile(data), sha: `sha-${filePath}-0` });
  }
  let writeCounter = 0;

  const jsonRes = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  });

  globalThis.fetch = async (url, options = {}) => {
    const u = new URL(url);
    const path = u.pathname;
    const method = options.method || 'GET';

    const contentsMatch = path.match(/^\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/);
    if (contentsMatch) {
      const filePath = decodeURIComponent(contentsMatch[1]);

      if (method === 'GET') {
        const file = files.get(filePath);
        if (!file) return jsonRes(404, { message: 'Not Found' });
        return jsonRes(200, {
          content: Buffer.from(file.content, 'utf8').toString('base64'),
          sha: file.sha,
        });
      }

      if (method === 'PUT') {
        const body = JSON.parse(options.body);
        writeCounter += 1;
        const newSha = `sha-${filePath}-${writeCounter}`;
        files.set(filePath, {
          content: Buffer.from(body.content, 'base64').toString('utf8'),
          sha: newSha,
        });
        return jsonRes(200, {
          commit: { sha: `commit-${newSha}`, html_url: 'https://example.com/commit' },
        });
      }
    }

    if (/\/git\/ref\/heads\//.test(path) && method === 'GET') {
      return jsonRes(200, { object: { sha: 'base-branch-sha' } });
    }
    if (/\/git\/refs$/.test(path) && method === 'POST') {
      return jsonRes(201, {});
    }
    if (/\/pulls$/.test(path) && method === 'POST') {
      return jsonRes(201, { number: 1, html_url: 'https://example.com/pr/1' });
    }

    throw new Error(`Unhandled mock fetch: ${method} ${path}`);
  };

  return { files };
}

function personalProject(overrides = {}) {
  return {
    title: 'Existing project',
    description: 'desc',
    repo: 'https://github.com/example/existing',
    updated_at: '2024-01-01T00:00:00.000Z',
    slug: 'existing-project',
    status: 'published',
    private: false,
    fav: false,
    priority_score: 100,
    tech: ['node'],
    links: [{ label: 'Repo', url: 'https://github.com/example/existing' }],
    ...overrides,
  };
}

function highlight(overrides = {}) {
  return {
    title: 'Shipped a thing',
    tag: 'work',
    year: '2024',
    technologies: ['node'],
    description: 'Did a thing.',
    ...overrides,
  };
}

function fastScore(overrides = {}) {
  return {
    ms: 178,
    timestamp: '2026-06-05T03:35:28.170Z',
    id: '8bbe3339',
    playerName: 'QuickPro12',
    playerId: 'kq1oqj',
    ...overrides,
  };
}

function tokenHeaders(token) {
  return { authorization: `Bearer ${token}` };
}

function sessionHeaders() {
  const token = createSessionToken('admin');
  return { cookie: `admin_session=${token}` };
}

async function readDecrypted(files, filePath) {
  const { decryptJson } = await import('../scripts/lib/content-crypto.mjs');
  const file = files.get(filePath);
  return JSON.parse(decryptJson(file.content));
}

test('token upserts an existing personal-projects record by slug (replaces, no duplicate)', async () => {
  process.env.INGEST_TOKENS = 'ci-projects:secret-personal:personal-projects';
  const { files } = installGithubMock({
    'data/encrypted/personal-projects.json.enc': { projects: [personalProject()] },
  });

  const res = await jsonFileHandler({
    httpMethod: 'POST',
    headers: tokenHeaders('secret-personal'),
    queryStringParameters: {},
    body: JSON.stringify({
      collection: 'personal-projects',
      record: personalProject({ title: 'Updated title', priority_score: 250 }),
    }),
  });

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.record.index, 0);
  assert.equal(body.record.record.title, 'Updated title');

  const stored = await readDecrypted(files, 'data/encrypted/personal-projects.json.enc');
  assert.equal(stored.projects.length, 1);
  assert.equal(stored.projects[0].title, 'Updated title');
  assert.equal(stored.projects[0].priority_score, 250);
});

test('token appends a new personal-projects record when slug does not match anything existing', async () => {
  process.env.INGEST_TOKENS = 'ci-projects:secret-personal:personal-projects';
  const { files } = installGithubMock({
    'data/encrypted/personal-projects.json.enc': { projects: [personalProject()] },
  });

  const res = await jsonFileHandler({
    httpMethod: 'POST',
    headers: tokenHeaders('secret-personal'),
    queryStringParameters: {},
    body: JSON.stringify({
      collection: 'personal-projects',
      record: personalProject({ slug: 'brand-new-project', title: 'Brand new' }),
    }),
  });

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.record.index, 1);

  const stored = await readDecrypted(files, 'data/encrypted/personal-projects.json.enc');
  assert.equal(stored.projects.length, 2);
  assert.equal(stored.projects[0].slug, 'existing-project');
  assert.equal(stored.projects[1].slug, 'brand-new-project');
});

test('token appends to highlights unconditionally (two calls produce two entries, not a merge)', async () => {
  process.env.INGEST_TOKENS = 'ci-highlights:secret-highlights:highlights';
  const { files } = installGithubMock({
    'data/encrypted/highlights.json.enc': { notes: [], highlights: [] },
  });

  const firstCall = () =>
    jsonFileHandler({
      httpMethod: 'POST',
      headers: tokenHeaders('secret-highlights'),
      queryStringParameters: {},
      body: JSON.stringify({ collection: 'highlights', record: highlight() }),
    });

  const res1 = await firstCall();
  assert.equal(res1.statusCode, 200);
  const res2 = await firstCall();
  assert.equal(res2.statusCode, 200);

  const stored = await readDecrypted(files, 'data/encrypted/highlights.json.enc');
  assert.equal(stored.highlights.length, 2);
  assert.deepEqual(stored.highlights[0], highlight());
  assert.deepEqual(stored.highlights[1], highlight());
});

test('token appends to fast-scores unconditionally (two calls produce two entries, not a merge)', async () => {
  process.env.INGEST_TOKENS = 'ci-fast-scores:secret-fast:fast-scores';
  const { files } = installGithubMock({
    'data/encrypted/fast-scores.json.enc': { scores: [] },
  });

  const postScore = (overrides) =>
    jsonFileHandler({
      httpMethod: 'POST',
      headers: tokenHeaders('secret-fast'),
      queryStringParameters: {},
      body: JSON.stringify({ collection: 'fast-scores', record: fastScore(overrides) }),
    });

  const res1 = await postScore({ id: '8bbe3339' });
  assert.equal(res1.statusCode, 200);
  const body1 = JSON.parse(res1.body);
  assert.deepEqual(body1.data.scores, [fastScore({ id: '8bbe3339' })]);

  const res2 = await postScore({ id: '56098390' });
  assert.equal(res2.statusCode, 200);
  const body2 = JSON.parse(res2.body);
  assert.equal(body2.data.scores.length, 2);
  assert.equal(body2.data.scores[0].id, '8bbe3339');
  assert.equal(body2.data.scores[1].id, '56098390');

  const stored = await readDecrypted(files, 'data/encrypted/fast-scores.json.enc');
  assert.equal(stored.scores.length, 2);
  assert.equal(stored.scores[0].id, '8bbe3339');
  assert.equal(stored.scores[1].id, '56098390');
});

test('a fast-scores token with writeMode=commit writes directly to master (no PR)', async () => {
  process.env.INGEST_TOKENS = 'ci-fast-scores:secret-fast:fast-scores:commit';
  const { files } = installGithubMock({
    'data/encrypted/fast-scores.json.enc': { scores: [] },
  });

  const res = await jsonFileHandler({
    httpMethod: 'POST',
    headers: tokenHeaders('secret-fast'),
    queryStringParameters: {},
    body: JSON.stringify({ collection: 'fast-scores', record: fastScore() }),
  });

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.write.pullRequest, null);
  assert.equal(body.write.branch, 'master');

  const stored = await readDecrypted(files, 'data/encrypted/fast-scores.json.enc');
  assert.equal(stored.scores.length, 1);
});

test('a token without writeMode still defaults to a PR write', async () => {
  process.env.INGEST_TOKENS = 'ci-highlights:secret-highlights:highlights';
  installGithubMock({
    'data/encrypted/highlights.json.enc': { notes: [], highlights: [] },
  });

  const res = await jsonFileHandler({
    httpMethod: 'POST',
    headers: tokenHeaders('secret-highlights'),
    queryStringParameters: {},
    body: JSON.stringify({ collection: 'highlights', record: highlight() }),
  });

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.ok(body.write.pullRequest);
  assert.notEqual(body.write.branch, 'master');
});

test('a token scoped to a different collection is rejected with 403', async () => {
  process.env.INGEST_TOKENS = 'ci-blogs:secret-blogs:blogs';
  installGithubMock({
    'data/encrypted/personal-projects.json.enc': { projects: [personalProject()] },
  });

  const res = await jsonFileHandler({
    httpMethod: 'POST',
    headers: tokenHeaders('secret-blogs'),
    queryStringParameters: {},
    body: JSON.stringify({ collection: 'personal-projects', record: personalProject() }),
  });

  assert.equal(res.statusCode, 403);
  const body = JSON.parse(res.body);
  assert.match(body.error, /personal-projects/);
});

test('a token attempting whole-document-replace ({ data }) is rejected', async () => {
  process.env.INGEST_TOKENS = 'ci-projects:secret-personal:personal-projects';
  installGithubMock({
    'data/encrypted/personal-projects.json.enc': { projects: [personalProject()] },
  });

  const res = await jsonFileHandler({
    httpMethod: 'POST',
    headers: tokenHeaders('secret-personal'),
    queryStringParameters: {},
    body: JSON.stringify({ collection: 'personal-projects', data: { projects: [] } }),
  });

  assert.equal(res.statusCode, 403);
  const body = JSON.parse(res.body);
  assert.match(body.error, /whole-document|record/i);
});

test('a session cookie can still perform the existing whole-document-replace unchanged', async () => {
  const { files } = installGithubMock({
    'data/encrypted/personal-projects.json.enc': { projects: [personalProject()] },
  });

  const res = await jsonFileHandler({
    httpMethod: 'POST',
    headers: sessionHeaders(),
    queryStringParameters: {},
    body: JSON.stringify({ collection: 'personal-projects', data: { projects: [] } }),
  });

  assert.equal(res.statusCode, 200);
  const stored = await readDecrypted(files, 'data/encrypted/personal-projects.json.enc');
  assert.deepEqual(stored.projects, []);
});
