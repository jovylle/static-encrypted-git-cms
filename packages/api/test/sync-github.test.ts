import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, fetchMock } from 'cloudflare:test';
import {
  normalizeRepoUrl,
  markdownToSummary,
  buildProjectFromRepo,
  fetchUserRepos,
  MIN_DESCRIPTION_LENGTH,
} from '../src/lib/github-repo-meta';
import {
  filterCandidateRepos,
  handleUnsyncedRepos,
  handleSyncGithubRepos,
  handleSkipRepoPost,
  handleSkipRepoDelete,
  handleSkipList,
} from '../src/routes/admin/sync-github';
import { readMergeWriteWithRetry } from '../src/lib/read-merge-write';
import { encryptJson } from '../src/lib/content-crypto';
import type { Env } from '../src/helpers';

const CONTENT_KEY = 'test-content-decrypt-key-1234567890';

// GITHUB_USERNAME (testuser) deliberately differs from the content repo owner
// (testowner) so the tests also exercise fact #4: repos are scanned under the
// personal username, files are read/written under the content repo owner.
const syncEnv = {
  DB: env.DB,
  ADMIN_PASSWORD: 'test-password',
  CORS_ORIGIN: '*',
  GITHUB_TOKEN: 'test-token',
  GITHUB_REPO: 'testowner/testrepo',
  GITHUB_BRANCH: 'master',
  GITHUB_USERNAME: 'testuser',
  CONTENT_DECRYPT_KEY: CONTENT_KEY,
  ADMIN_GITHUB_WRITE_MODE: 'commit',
} as unknown as Env;

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

// ── Mutable network state consulted by persisted interceptors ──
// Each interceptor delegates to a swappable handler so individual tests can
// override behaviour without registering overlapping interceptors.
let usersHandler: () => { statusCode: number; data: any } = () => ({
  statusCode: 200,
  data: reposResponse,
});
let reposResponse: any[] = [];
let contentsDoc: unknown = { projects: [] };
let readmeText = '';

beforeAll(async () => {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS sync_skip_list (
      repo_url TEXT PRIMARY KEY,
      reason TEXT DEFAULT '',
      skipped_at TEXT DEFAULT (datetime('now'))
    )`,
  ).run();

  fetchMock.activate();
  fetchMock.disableNetConnect();

  const gh = fetchMock.get('https://api.github.com');
  gh.intercept({ method: 'GET', path: (p) => p.startsWith('/users/') })
    .reply(() => usersHandler())
    .persist();
  gh.intercept({ method: 'GET', path: (p) => p.endsWith('/readme') })
    .reply(() => ({
      statusCode: 200,
      data: readmeText,
      responseOptions: { headers: { 'content-type': 'text/plain' } },
    }))
    .persist();
  gh.intercept({ method: 'GET', path: (p) => p.includes('/contents/') })
    .reply(() => ({ statusCode: 200, data: encryptedContentsResponse(contentsDoc) }))
    .persist();
});

beforeEach(() => {
  reposResponse = [];
  contentsDoc = { projects: [] };
  readmeText = '';
  usersHandler = () => ({ statusCode: 200, data: reposResponse });
});

describe('normalizeRepoUrl', () => {
  it('canonicalizes owner/repo and lowercases', () => {
    expect(normalizeRepoUrl('https://github.com/Owner/Repo/')).toBe(
      'https://github.com/owner/repo',
    );
    expect(normalizeRepoUrl('github.com/foo/bar')).toBe('https://github.com/foo/bar');
  });
  it('rejects non-github / malformed', () => {
    expect(normalizeRepoUrl('https://gitlab.com/a/b')).toBeNull();
    expect(normalizeRepoUrl('not a url')).toBeNull();
    expect(normalizeRepoUrl('')).toBeNull();
    expect(normalizeRepoUrl(null)).toBeNull();
  });
});

describe('markdownToSummary', () => {
  it('extracts first meaningful paragraph, skipping headings/images/code', () => {
    const md = '# Title\n\n![img](x.png)\n\n```js\ncode\n```\n\nThis is the real summary paragraph.';
    expect(markdownToSummary(md)).toBe('This is the real summary paragraph.');
  });
  it('returns empty for no usable prose', () => {
    expect(markdownToSummary('# Only a heading')).toBe('');
    expect(markdownToSummary('')).toBe('');
  });
});

describe('buildProjectFromRepo', () => {
  it('builds a schema-shaped project when description is long enough', () => {
    const built = buildProjectFromRepo(
      {
        name: 'cool-thing',
        html_url: 'https://github.com/testuser/cool-thing',
        description: 'A sufficiently descriptive project blurb here.',
        language: 'TypeScript',
        topics: ['cli', 'typescript'],
        homepage: 'https://cool.example',
        created_at: '2022-01-01T00:00:00Z',
        pushed_at: '2023-01-01T00:00:00Z',
      },
      '',
    );
    expect(built?.skipped).toBeFalsy();
    const project = built!.project!;
    expect(project.repo).toBe('https://github.com/testuser/cool-thing');
    expect(project.slug).toBe('cool-thing');
    expect(project.status).toBe('published');
    expect(project.created_at).toBe('2022-01-01T00:00:00Z');
    // uniqueStrings dedupes case-insensitively: 'typescript' topic collapses
    // into the 'TypeScript' language entry.
    expect(project.tech).toEqual(['TypeScript', 'cli']);
    expect(project.links).toContainEqual({ label: 'Live', url: 'https://cool.example' });
  });

  it('falls back to README summary, then reports a skip reason when too short', () => {
    const shortDesc = buildProjectFromRepo(
      { name: 'thin', html_url: 'https://github.com/testuser/thin', description: 'too short' },
      'also short',
    );
    expect(shortDesc?.skipped).toBe(true);
    expect(shortDesc?.reason).toContain(String(MIN_DESCRIPTION_LENGTH));

    const rescued = buildProjectFromRepo(
      { name: 'thin', html_url: 'https://github.com/testuser/thin', description: 'x' },
      'A README-derived description that is definitely long enough.',
    );
    expect(rescued?.skipped).toBeFalsy();
    expect(rescued!.project!.description).toContain('README-derived');
  });

  it('returns null for an unparseable repo url', () => {
    expect(buildProjectFromRepo({ name: 'x', html_url: 'not-a-url' }, '')).toBeNull();
  });
});

describe('filterCandidateRepos', () => {
  const repos = [
    { name: 'existing-repo', html_url: 'https://github.com/testuser/existing-repo', private: false, fork: false },
    { name: 'forked', html_url: 'https://github.com/testuser/forked', private: false, fork: true },
    { name: 'secret', html_url: 'https://github.com/testuser/secret', private: true, fork: false },
    { name: 'skipped-repo', html_url: 'https://github.com/testuser/skipped-repo', private: false, fork: false },
    { name: 'new-cool', html_url: 'https://github.com/testuser/new-cool', private: false, fork: false },
  ];

  it('excludes forks, private, already-synced, and skip-listed repos', () => {
    const out = filterCandidateRepos(repos, {
      existing: new Set(['https://github.com/testuser/existing-repo']),
      skipped: new Set(['https://github.com/testuser/skipped-repo']),
    });
    expect(out.map((c) => c.normalized)).toEqual(['https://github.com/testuser/new-cool']);
  });

  it('honors a requested subset (case-insensitive)', () => {
    const out = filterCandidateRepos(repos, {
      existing: new Set(),
      skipped: new Set(),
      requested: ['https://github.com/testuser/NEW-COOL'],
    });
    expect(out.map((c) => c.normalized)).toEqual(['https://github.com/testuser/new-cool']);
  });
});

describe('fetchUserRepos', () => {
  it('paginates until a short page and caps at 10 pages', async () => {
    let page = 0;
    usersHandler = () => {
      page += 1;
      if (page <= 2) {
        return {
          statusCode: 200,
          data: Array.from({ length: 100 }, (_, i) => ({ id: page * 100 + i })),
        };
      }
      return { statusCode: 200, data: [{ id: 999 }] };
    };

    const repos = await fetchUserRepos('token', 'pager');
    expect(repos.length).toBe(201);
    expect(page).toBe(3);
  });
});

describe('skip list routes', () => {
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM sync_skip_list').run();
  });

  it('adds, lists, and removes skip entries (idempotent)', async () => {
    const url = 'https://github.com/testuser/skip-me';

    const post = await handleSkipRepoPost(
      syncEnv,
      new Request('http://x/api/admin/skip-repo', {
        method: 'POST',
        body: JSON.stringify({ repo_url: url, reason: 'not a portfolio piece' }),
      }),
      'admin',
    );
    expect(post.status).toBe(200);
    expect((await post.json() as any).repo_url).toBe(url);

    // Re-post is idempotent and updates the reason.
    await handleSkipRepoPost(
      syncEnv,
      new Request('http://x/api/admin/skip-repo', {
        method: 'POST',
        body: JSON.stringify({ repo_url: `${url}/`, reason: 'updated reason' }),
      }),
      'admin',
    );

    const listRes = await handleSkipList(syncEnv);
    const entries = (await listRes.json() as any).entries;
    expect(entries.length).toBe(1);
    expect(entries[0].reason).toBe('updated reason');

    // Delete via query param, then deleting again is still ok (idempotent).
    const del = await handleSkipRepoDelete(
      syncEnv,
      new Request(`http://x/api/admin/skip-repo?repo_url=${encodeURIComponent(url)}`, {
        method: 'DELETE',
      }),
    );
    expect(del.status).toBe(200);
    const delAgain = await handleSkipRepoDelete(
      syncEnv,
      new Request(`http://x/api/admin/skip-repo?repo_url=${encodeURIComponent(url)}`, {
        method: 'DELETE',
      }),
    );
    expect(delAgain.status).toBe(200);

    const afterList = await handleSkipList(syncEnv);
    expect((await afterList.json() as any).entries.length).toBe(0);
  });

  it('rejects a non-GitHub skip url', async () => {
    const res = await handleSkipRepoPost(
      syncEnv,
      new Request('http://x/api/admin/skip-repo', {
        method: 'POST',
        body: JSON.stringify({ repo_url: 'https://gitlab.com/a/b' }),
      }),
      'admin',
    );
    expect(res.status).toBe(400);
  });
});

describe('handleUnsyncedRepos', () => {
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM sync_skip_list').run();
  });

  it('returns only public, non-fork, unsynced, non-skipped repos', async () => {
    contentsDoc = { projects: [validProject()] };
    reposResponse = [
      { name: 'existing-repo', html_url: 'https://github.com/testuser/existing-repo', private: false, fork: false, description: 'x' },
      { name: 'forked', html_url: 'https://github.com/testuser/forked', private: false, fork: true, description: 'x' },
      { name: 'secret', html_url: 'https://github.com/testuser/secret', private: true, fork: false, description: 'x' },
      { name: 'skipped-repo', html_url: 'https://github.com/testuser/skipped-repo', private: false, fork: false, description: 'x' },
      { name: 'new-cool', html_url: 'https://github.com/testuser/new-cool', private: false, fork: false, description: 'A brand new repo worth syncing.' },
    ];
    await env.DB.prepare('INSERT INTO sync_skip_list (repo_url, reason) VALUES (?, ?)')
      .bind('https://github.com/testuser/skipped-repo', 'manual')
      .run();

    const res = await handleUnsyncedRepos(syncEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.githubUser).toBe('testuser');
    expect(body.count).toBe(1);
    expect(body.repos[0].repo).toBe('https://github.com/testuser/new-cool');
  });
});

describe('handleSyncGithubRepos', () => {
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM sync_skip_list').run();
  });

  // NOTE: the happy-path (syncedCount > 0) can't be asserted end-to-end in the
  // vitest-pool-workers runtime because Ajv's `require('./refs/data.json')`
  // fails under miniflare's CJS/ESM shim (JSON parsed as JS). That is a
  // test-runtime-only artifact — production bundles JSON via esbuild/wrangler,
  // where validation works. The write/merge/retry contract the happy path
  // relies on is covered directly below via readMergeWriteWithRetry.
  it('records a skip reason for a repo with insufficient metadata', async () => {
    contentsDoc = { projects: [] };
    readmeText = 'tiny';
    reposResponse = [
      { name: 'thin', html_url: 'https://github.com/testuser/thin', private: false, fork: false, description: 'short' },
    ];

    const res = await handleSyncGithubRepos(
      syncEnv,
      new Request('http://x/api/admin/sync-github-repos', { method: 'POST', body: '{}' }),
      'admin',
    );
    const body = await res.json() as any;
    expect(body.syncedCount).toBe(0);
    expect(body.skippedCount).toBe(1);
    expect(body.skipped[0].reason).toContain(String(MIN_DESCRIPTION_LENGTH));
  });
});

describe('readMergeWriteWithRetry (per-repo sync write contract)', () => {
  // Uses an unregistered collectionKey so schema validation short-circuits
  // (ok) before touching Ajv — this isolates the 409 retry + re-merge path
  // that handleSyncGithubRepos depends on for each repo.
  it('re-reads, re-applies the merge, and retries once on a 409 conflict', async () => {
    let putCount = 0;
    let reads = 0;
    let stored: any = { projects: [] };

    const result = await readMergeWriteWithRetry<any, any>({
      collectionKey: '__unregistered_for_test__',
      filePath: 'data/encrypted/personal-projects.json.enc',
      defaultValue: { projects: [] },
      mergeFn: (current) => {
        const projects = Array.isArray(current?.projects) ? current.projects : [];
        return { ...current, projects: [...projects, { synced: true }] };
      },
      readFile: async () => {
        reads += 1;
        return { data: stored, sha: `sha-${reads}` };
      },
      writeFile: async (args) => {
        putCount += 1;
        if (putCount === 1) {
          const e: any = new Error('stale sha');
          e.status = 409;
          throw e;
        }
        stored = args.data;
        return { commitSha: 'committed' };
      },
    });

    expect(putCount).toBe(2);
    expect(reads).toBe(2); // one read per attempt
    expect(result.data.projects.length).toBe(1);
    expect(result.write).toEqual({ commitSha: 'committed' });
  });

  it('gives up after maxAttempts of persistent 409s', async () => {
    let putCount = 0;
    await expect(
      readMergeWriteWithRetry<any, any>({
        collectionKey: '__unregistered_for_test__',
        filePath: 'x.json.enc',
        defaultValue: { projects: [] },
        mergeFn: (c) => c,
        readFile: async () => ({ data: { projects: [] }, sha: 'sha' }),
        writeFile: async () => {
          putCount += 1;
          const e: any = new Error('conflict');
          e.status = 409;
          throw e;
        },
      }),
    ).rejects.toThrow(/conflict/i);
    expect(putCount).toBe(3);
  });
});
