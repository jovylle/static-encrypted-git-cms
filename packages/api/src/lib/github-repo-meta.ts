/**
 * Minimum length (chars) a project description must reach before a repo is
 * considered worth syncing into personal-projects. Mirrors the local script
 * `scripts/sync-github-personal-projects.mjs` (kept as a named constant here,
 * not an env binding, so both write paths agree on the same threshold).
 */
export const MIN_DESCRIPTION_LENGTH = 24;

const GITHUB_HEADERS_BASE: Record<string, string> = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'static-encrypted-cms-admin',
};

async function githubApiRequest(
  token: string,
  url: string,
  accept: string = 'application/vnd.github+json',
): Promise<Response> {
  const headers: Record<string, string> = { ...GITHUB_HEADERS_BASE, Accept: accept };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { method: 'GET', headers });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err: any = new Error(`GitHub API ${res.status}: ${detail.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return res;
}

/**
 * Canonicalize a GitHub repo URL to `https://github.com/{owner}/{repo}`
 * (lowercased). Used as the identity key when diffing repos against the
 * projects list and the skip list. Returns null for non-GitHub / malformed
 * input. Ported from the local sync script so both write paths dedupe alike.
 */
export function normalizeRepoUrl(url: unknown): string | null {
  if (!url || typeof url !== 'string') return null;
  let value = url.trim();
  if (!value) return null;
  if (!value.startsWith('http')) {
    value = `https://${value.replace(/^\/+/, '')}`;
  }
  if (!value.includes('github.com/')) return null;
  const parts = value.replace(/\/$/, '').toLowerCase().split('/');
  if (parts.length < 5) return null;
  return `https://github.com/${parts[3]}/${parts[4]}`;
}

function uniqueStrings(values: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value || typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function cleanupText(value: unknown): string {
  if (!value || typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Extract a short plain-text summary from README markdown: strips code blocks,
 * headings, images, and inline markup, returning the first meaningful
 * paragraph (capped at 280 chars). Ported from the local sync script.
 */
export function markdownToSummary(markdown: unknown): string {
  if (!markdown || typeof markdown !== 'string') return '';
  const noCodeBlocks = markdown.replace(/```[\s\S]*?```/g, ' ');
  const paragraphs = noCodeBlocks
    .split(/\n\s*\n/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  for (const raw of paragraphs) {
    if (
      raw.startsWith('#') ||
      raw.startsWith('![') ||
      raw.startsWith('<!--') ||
      raw.startsWith('<img')
    ) {
      continue;
    }
    const cleaned = cleanupText(
      raw
        .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/[*_~]+/g, '')
        .replace(/^[-*+]\s+/gm, '')
        .replace(/^>\s+/gm, ''),
    );
    if (cleaned.length >= 12) {
      return cleaned.slice(0, 280);
    }
  }

  return '';
}

/**
 * Fetch every owner-type repo for a GitHub user, following pagination. Capped
 * at 10 pages / 1000 repos so a misbehaving account can never loop unbounded.
 */
export async function fetchUserRepos(
  token: string,
  username: string,
): Promise<any[]> {
  const repos: any[] = [];
  const perPage = 100;
  const MAX_PAGES = 10;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url =
      `https://api.github.com/users/${encodeURIComponent(username)}/repos` +
      `?type=owner&sort=created&direction=desc&per_page=${perPage}&page=${page}`;
    const res = await githubApiRequest(token, url);
    const chunk: any = await res.json().catch(() => null);
    if (!Array.isArray(chunk) || chunk.length === 0) break;
    repos.push(...chunk);
    if (chunk.length < perPage) break;
  }
  return repos;
}

/**
 * Fetch and summarize a repo's README. Returns '' on any error (missing
 * README, private, rate-limited) so callers can fall back gracefully.
 */
export async function fetchReadmeSummary(
  token: string,
  owner: string,
  repoName: string,
): Promise<string> {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}/readme`;
  try {
    const res = await githubApiRequest(token, url, 'application/vnd.github.raw+json');
    const markdown = await res.text();
    return markdownToSummary(markdown);
  } catch {
    return '';
  }
}

export interface BuiltProject {
  project?: Record<string, any>;
  skipped?: boolean;
  reason?: string;
  repo?: string;
}

/**
 * Build a personal-projects entry from a GitHub repo object + optional README
 * summary. Returns `{ project }` when there is enough metadata, or
 * `{ skipped, reason, repo }` when the description is too short. Returns null
 * for an unparseable repo URL. Ported from the local sync script.
 */
export function buildProjectFromRepo(
  repo: any,
  readmeSummary: string,
): BuiltProject | null {
  const normalizedRepo = normalizeRepoUrl(repo?.html_url);
  if (!normalizedRepo) return null;

  const fromRepo = cleanupText(repo?.description || '');
  const fromReadme = cleanupText(readmeSummary || '');
  const description =
    fromRepo.length >= MIN_DESCRIPTION_LENGTH ? fromRepo : fromReadme;

  if (description.length < MIN_DESCRIPTION_LENGTH) {
    return {
      skipped: true,
      reason: `description too short (<${MIN_DESCRIPTION_LENGTH})`,
      repo: normalizedRepo,
    };
  }

  const tech = uniqueStrings([
    repo?.language,
    ...(Array.isArray(repo?.topics) ? repo.topics : []),
  ]);

  const links: { label: string; url: string }[] = [
    { label: 'Repo', url: normalizedRepo },
  ];
  if (repo?.homepage && /^https?:\/\//i.test(repo.homepage)) {
    links.push({ label: 'Live', url: repo.homepage });
  }

  const project: Record<string, any> = {
    title: repo.name,
    description,
    repo: normalizedRepo,
    updated_at:
      repo.pushed_at || repo.updated_at || repo.created_at || new Date().toISOString(),
    slug: repo.name,
    status: 'published',
    private: false,
    fav: false,
    priority_score: 100,
    tech,
    links,
    thumbnail: '',
  };
  if (repo.created_at) project.created_at = repo.created_at;
  if (tech.length) project.language = tech.join(', ');

  return { project };
}

function parseGithubRepoUrl(repoUrl: string): { owner: string; repo: string } | null {
  if (!repoUrl || typeof repoUrl !== 'string') return null;
  try {
    const url = new URL(repoUrl);
    if (!/github\.com$/i.test(url.hostname)) return null;
    const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
    if (parts.length < 2) return null;
    return { owner: parts[0], repo: parts[1] };
  } catch {
    return null;
  }
}

export async function fetchRepoCreatedAt(
  token: string,
  repoUrl: string,
): Promise<string | null> {
  const ref = parseGithubRepoUrl(repoUrl);
  if (!ref) return null;

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'static-encrypted-cms-admin',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`https://api.github.com/repos/${ref.owner}/${ref.repo}`, {
    method: 'GET',
    headers,
  });
  if (!res.ok) return null;

  const json: any = await res.json().catch(() => null);
  return json?.created_at || null;
}
