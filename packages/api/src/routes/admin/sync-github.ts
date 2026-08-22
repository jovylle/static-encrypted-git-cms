import {
  Env,
  jsonResponse,
  parseJsonBody,
  badRequest,
  serverError,
  getQueryParam,
} from '../../helpers';
import {
  readEncryptedJsonFile,
  writeEncryptedJsonFile,
} from '../../lib/encrypted-content-store';
import { readMergeWriteWithRetry } from '../../lib/read-merge-write';
import { getGithubConfig } from '../../lib/github-content';
import {
  normalizeRepoUrl,
  fetchUserRepos,
  fetchReadmeSummary,
  buildProjectFromRepo,
  MIN_DESCRIPTION_LENGTH,
} from '../../lib/github-repo-meta';

const PROJECTS_FILE = 'data/encrypted/personal-projects.json.enc';
const COLLECTION_KEY = 'personal-projects';
const DEFAULT_PROJECTS = { projects: [] as any[] };

/**
 * Resolve the GitHub account whose repos we scan for sync candidates. This can
 * differ from the CMS content repo owner (used for reading/writing the
 * encrypted files), so it has its own `GITHUB_USERNAME` var and falls back to
 * the content repo owner when unset.
 */
function resolveGithubUsername(env: Env, owner: string): string {
  const configured = (env.GITHUB_USERNAME || '').trim();
  return configured || owner;
}

/** Set of normalized repo URLs already present in personal-projects. */
function existingRepoSet(data: any): Set<string> {
  const projects = Array.isArray(data?.projects) ? data.projects : [];
  const set = new Set<string>();
  for (const project of projects) {
    const normalized = normalizeRepoUrl(project?.repo);
    if (normalized) set.add(normalized);
  }
  return set;
}

/** Set of normalized repo URLs the admin has chosen to skip (from D1). */
async function skippedRepoSet(env: Env): Promise<Set<string>> {
  const { results } = await env.DB.prepare(
    'SELECT repo_url FROM sync_skip_list',
  ).all<{ repo_url: string }>();
  const set = new Set<string>();
  for (const row of results || []) {
    const normalized = normalizeRepoUrl(row.repo_url) || row.repo_url;
    if (normalized) set.add(normalized);
  }
  return set;
}

export interface RepoCandidate {
  repo: any;
  normalized: string;
}

/**
 * Pure filter: public + non-fork repos that are neither already synced nor on
 * the skip list, optionally narrowed to a requested subset (normalized URLs).
 * Exported for direct unit testing of the diffing rules.
 */
export function filterCandidateRepos(
  repos: any[],
  opts: { existing: Set<string>; skipped: Set<string>; requested?: string[] | null },
): RepoCandidate[] {
  const { existing, skipped, requested } = opts;
  const requestedSet =
    requested && requested.length
      ? new Set(
          requested
            .map((url) => normalizeRepoUrl(url))
            .filter((url): url is string => Boolean(url)),
        )
      : null;

  const out: RepoCandidate[] = [];
  const seen = new Set<string>();
  for (const repo of Array.isArray(repos) ? repos : []) {
    // public + non-fork = GitHub's own booleans, no other filtering.
    if (!repo || repo.private === true || repo.fork === true) continue;
    const normalized = normalizeRepoUrl(repo.html_url);
    if (!normalized || seen.has(normalized)) continue;
    if (existing.has(normalized)) continue;
    if (skipped.has(normalized)) continue;
    if (requestedSet && !requestedSet.has(normalized)) continue;
    seen.add(normalized);
    out.push({ repo, normalized });
  }
  return out;
}

/** Lightweight repo shape returned to the admin UI (no README fetch here). */
function repoSummary(candidate: RepoCandidate) {
  const { repo, normalized } = candidate;
  return {
    repo: normalized,
    name: repo.name,
    full_name: repo.full_name,
    description: repo.description || '',
    html_url: repo.html_url,
    homepage: repo.homepage || '',
    language: repo.language || '',
    pushed_at: repo.pushed_at || repo.updated_at || '',
    created_at: repo.created_at || '',
  };
}

/**
 * GET /api/admin/unsynced-repos
 * Fetch public/non-fork repos for the configured GitHub user and return those
 * not yet in personal-projects and not skipped. Read-only, no README fetch.
 */
export async function handleUnsyncedRepos(env: Env): Promise<Response> {
  try {
    const config = getGithubConfig(env);
    const username = resolveGithubUsername(env, config.owner);

    const [{ data }, skipped, repos] = await Promise.all([
      readEncryptedJsonFile(env, PROJECTS_FILE, DEFAULT_PROJECTS),
      skippedRepoSet(env),
      fetchUserRepos(config.token, username),
    ]);

    const existing = existingRepoSet(data);
    const candidates = filterCandidateRepos(repos, { existing, skipped });

    return jsonResponse({
      ok: true,
      githubUser: username,
      count: candidates.length,
      repos: candidates.map(repoSummary),
    });
  } catch (e: any) {
    return serverError(e.message);
  }
}

/**
 * POST /api/admin/sync-github-repos
 * Sync all currently-unsynced repos, or a subset if the body carries
 * `repoUrls` (array) / `repoUrl` (single). Each repo is synced in its OWN
 * read-merge-write cycle for failure isolation (N repos => N commits/PRs).
 */
export async function handleSyncGithubRepos(
  env: Env,
  request: Request,
  adminUser: string,
): Promise<Response> {
  let body: any;
  try {
    body = await parseJsonBody(request);
  } catch (e: any) {
    return badRequest(e.message);
  }

  let requested: string[] | null = null;
  if (Array.isArray(body?.repoUrls)) requested = body.repoUrls;
  else if (typeof body?.repoUrl === 'string' && body.repoUrl.trim()) {
    requested = [body.repoUrl];
  }

  try {
    const config = getGithubConfig(env);
    const username = resolveGithubUsername(env, config.owner);

    const [{ data }, skipped, repos] = await Promise.all([
      readEncryptedJsonFile(env, PROJECTS_FILE, DEFAULT_PROJECTS),
      skippedRepoSet(env),
      fetchUserRepos(config.token, username),
    ]);

    const existing = existingRepoSet(data);
    const candidates = filterCandidateRepos(repos, { existing, skipped, requested });

    const synced: { repo: string; slug: string; write: unknown }[] = [];
    const skippedRepos: { repo: string; reason: string }[] = [];
    const failed: { repo: string; error: string }[] = [];

    for (const { repo, normalized } of candidates) {
      // Only spend a README request when the repo description is too thin.
      const descLen = (typeof repo.description === 'string'
        ? repo.description.replace(/\s+/g, ' ').trim()
        : ''
      ).length;
      const readmeSummary =
        descLen >= MIN_DESCRIPTION_LENGTH
          ? ''
          : await fetchReadmeSummary(config.token, username, repo.name);

      const built = buildProjectFromRepo(repo, readmeSummary);
      if (!built || built.skipped || !built.project) {
        skippedRepos.push({
          repo: normalized,
          reason: built?.reason || 'cannot build project payload',
        });
        continue;
      }
      const project = built.project;

      try {
        const result = await readMergeWriteWithRetry<any, unknown>({
          collectionKey: COLLECTION_KEY,
          filePath: PROJECTS_FILE,
          defaultValue: DEFAULT_PROJECTS,
          // Re-check existence inside the merge so a concurrent writer that
          // added this repo between attempts doesn't produce a duplicate.
          mergeFn: (current) => {
            const doc =
              current && typeof current === 'object' && !Array.isArray(current)
                ? current
                : { projects: [] };
            const projects = Array.isArray(doc.projects) ? doc.projects : [];
            const already = projects.some(
              (p: any) => normalizeRepoUrl(p?.repo) === normalized,
            );
            if (!already) projects.push(project);
            return { ...doc, projects };
          },
          actor: adminUser,
          branchHint: `sync-${project.slug}`,
          message: `admin: sync project from GitHub (${project.slug})`,
          writeMode: env.ADMIN_GITHUB_WRITE_MODE,
          readFile: (filePath, defaultValue) =>
            readEncryptedJsonFile(env, filePath, defaultValue),
          writeFile: (args) =>
            writeEncryptedJsonFile(env, {
              filePath: args.filePath,
              data: args.data,
              sha: args.sha,
              actor: args.actor || adminUser,
              branchHint: args.branchHint || `sync-${project.slug}`,
              message:
                args.message ||
                `admin: sync project from GitHub (${project.slug})`,
            }),
        });
        synced.push({ repo: normalized, slug: project.slug, write: result.write });
      } catch (e: any) {
        const entry: { repo: string; error: string; details?: string[] } = {
          repo: normalized,
          error: e?.message || String(e),
        };
        if (Array.isArray(e?.validationErrors)) entry.details = e.validationErrors;
        failed.push(entry);
      }
    }

    return jsonResponse({
      ok: true,
      githubUser: username,
      syncedCount: synced.length,
      skippedCount: skippedRepos.length,
      failedCount: failed.length,
      synced,
      skipped: skippedRepos,
      failed,
    });
  } catch (e: any) {
    return serverError(e.message);
  }
}

/**
 * POST /api/admin/skip-repo
 * Add a repo URL (+ optional reason) to the skip list. Idempotent: re-posting
 * updates the reason and leaves the original skipped_at intact.
 */
export async function handleSkipRepoPost(
  env: Env,
  request: Request,
  _adminUser: string,
): Promise<Response> {
  let body: any;
  try {
    body = await parseJsonBody(request);
  } catch (e: any) {
    return badRequest(e.message);
  }

  const rawUrl = body?.repo_url ?? body?.repoUrl;
  if (!rawUrl || typeof rawUrl !== 'string') {
    return badRequest('repo_url is required');
  }
  const normalized = normalizeRepoUrl(rawUrl);
  if (!normalized) return badRequest('repo_url must be a GitHub repository URL');

  const reason =
    typeof body?.reason === 'string' ? body.reason.trim() : '';

  try {
    await env.DB.prepare(
      `INSERT INTO sync_skip_list (repo_url, reason)
       VALUES (?, ?)
       ON CONFLICT(repo_url) DO UPDATE SET reason = excluded.reason`,
    )
      .bind(normalized, reason)
      .run();

    return jsonResponse({ ok: true, repo_url: normalized, reason });
  } catch (e: any) {
    return serverError(e.message);
  }
}

/**
 * DELETE /api/admin/skip-repo?repo_url=<url>
 * Remove a repo URL from the skip list (query param, not body — proxies may
 * strip DELETE bodies). Idempotent: removing an absent URL still returns ok.
 */
export async function handleSkipRepoDelete(
  env: Env,
  request: Request,
): Promise<Response> {
  const rawUrl = getQueryParam(request.url, 'repo_url');
  if (!rawUrl) return badRequest('repo_url query parameter is required');
  const normalized = normalizeRepoUrl(rawUrl) || rawUrl;

  try {
    await env.DB.prepare('DELETE FROM sync_skip_list WHERE repo_url = ?')
      .bind(normalized)
      .run();
    return jsonResponse({ ok: true, repo_url: normalized });
  } catch (e: any) {
    return serverError(e.message);
  }
}

/**
 * GET /api/admin/skip-list
 * List current skip-list entries, newest first.
 */
export async function handleSkipList(env: Env): Promise<Response> {
  try {
    const { results } = await env.DB.prepare(
      'SELECT repo_url, reason, skipped_at FROM sync_skip_list ORDER BY skipped_at DESC',
    ).all();
    return jsonResponse({ ok: true, entries: results || [] });
  } catch (e: any) {
    return serverError(e.message);
  }
}
