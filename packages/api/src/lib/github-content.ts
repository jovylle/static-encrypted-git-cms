interface GithubConfig {
  token: string;
  owner: string;
  repo: string;
  baseBranch: string;
  writeMode: string;
}

function parseRepo(repoText: string): { owner: string; repo: string } {
  const [owner, repo] = String(repoText || '').split('/');
  if (!owner || !repo) {
    throw new Error('GITHUB_REPO must be set as "owner/repo".');
  }
  return { owner, repo };
}

export function getGithubConfig(env: {
  GITHUB_TOKEN?: string;
  GITHUB_REPO?: string;
  GITHUB_BRANCH?: string;
  ADMIN_GITHUB_WRITE_MODE?: string;
}): GithubConfig {
  const token = env.GITHUB_TOKEN || '';
  if (!token) throw new Error('GITHUB_TOKEN is required for admin writeback.');
  const repoText = env.GITHUB_REPO || 'jovylle/static-encrypted-git-cms';
  const baseBranch = env.GITHUB_BRANCH || 'master';
  const writeMode = env.ADMIN_GITHUB_WRITE_MODE || 'commit';
  const { owner, repo } = parseRepo(repoText);
  return { token, owner, repo, baseBranch, writeMode };
}

async function githubRequest(
  config: GithubConfig,
  endpoint: string,
  options: RequestInit = {},
): Promise<any> {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${config.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'static-encrypted-cms-admin',
      ...(options.headers as Record<string, string> || {}),
    },
  });

  if (!res.ok) {
    const detail = await res.text();
    const err: any = new Error(`GitHub API ${res.status}: ${detail}`);
    err.status = res.status;
    throw err;
  }

  if (res.status === 204) return null;
  return res.json();
}

function toGithubContent(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

function encodePath(filePath: string): string {
  return String(filePath)
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function fromGithubContent(encoded: string): string {
  return Buffer.from(String(encoded || '').replace(/\n/g, ''), 'base64').toString('utf8');
}

async function ensureBranch(config: GithubConfig, branchName: string): Promise<void> {
  const baseRef = await githubRequest(
    config,
    `/repos/${config.owner}/${config.repo}/git/ref/heads/${config.baseBranch}`,
  );
  try {
    await githubRequest(config, `/repos/${config.owner}/${config.repo}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha: baseRef.object.sha,
      }),
    });
  } catch (e: any) {
    if (e.status !== 422) throw e;
  }
}

async function createPullRequest(
  config: GithubConfig,
  title: string,
  branchName: string,
  body: string,
): Promise<{ number: number; url: string }> {
  const pr = await githubRequest(config, `/repos/${config.owner}/${config.repo}/pulls`, {
    method: 'POST',
    body: JSON.stringify({ title, head: branchName, base: config.baseBranch, body }),
  });
  return { number: pr.number, url: pr.html_url };
}

export async function getRepoTextFile(
  config: GithubConfig,
  filePath: string,
  ref: string | null = null,
): Promise<{
  text?: string | null;
  sha?: string | null;
  exists: boolean;
  entries?: any[] | null;
}> {
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  const endpoint = `/repos/${config.owner}/${config.repo}/contents/${encodePath(filePath)}${query}`;

  try {
    const json = await githubRequest(config, endpoint);
    if (Array.isArray(json)) {
      return { entries: json, exists: true };
    }
    return { text: fromGithubContent(json.content), sha: json.sha, exists: true };
  } catch (e: any) {
    if (e.status === 404) return { text: null, sha: null, exists: false, entries: null };
    throw e;
  }
}

export async function listRepoDirectory(
  config: GithubConfig,
  dirPath: string,
  ref: string | null = null,
): Promise<{ name: string; path: string; sha: string }[]> {
  const result = await getRepoTextFile(config, dirPath, ref);
  if (!result.exists) return [];
  if (!Array.isArray(result.entries)) {
    throw new Error(`Path is not a directory: ${dirPath}`);
  }
  return (result.entries as any[])
    .filter((entry: any) => entry.type === 'file')
    .map((entry: any) => ({
      name: entry.name,
      path: entry.path,
      sha: entry.sha,
    }));
}

export async function writeRepoTextFile(
  config: GithubConfig,
  params: {
    filePath: string;
    content: string;
    message: string;
    actor?: string;
    branchHint?: string;
    previousSha?: string;
  },
): Promise<{
  commitSha: string | null;
  commitUrl: string | null;
  branch: string;
  pullRequest: { number: number; url: string } | null;
}> {
  const { filePath, content, message, actor = 'admin', branchHint = 'update', previousSha } = params;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const branchName = `admin/${branchHint}-${timestamp}`;
  const usePr = config.writeMode === 'pr';
  const targetBranch = usePr ? branchName : config.baseBranch;

  if (usePr) {
    await ensureBranch(config, branchName);
  }

  const commitBody: any = {
    message: `${message}\n\nadmin-actor: ${actor}`,
    content: toGithubContent(content),
    branch: targetBranch,
  };
  if (previousSha) commitBody.sha = previousSha;

  const commit = await githubRequest(
    config,
    `/repos/${config.owner}/${config.repo}/contents/${encodePath(filePath)}`,
    { method: 'PUT', body: JSON.stringify(commitBody) },
  );

  let pullRequest: { number: number; url: string } | null = null;
  if (usePr) {
    const prTitle = message;
    const prBody = `Automated admin update by \`${actor}\`.`;
    pullRequest = await createPullRequest(config, prTitle, branchName, prBody);
  }

  return {
    commitSha: commit.commit?.sha || null,
    commitUrl: commit.commit?.html_url || null,
    branch: targetBranch,
    pullRequest,
  };
}

export async function deleteRepoFile(
  config: GithubConfig,
  params: {
    filePath: string;
    sha: string;
    message: string;
    actor?: string;
    branchHint?: string;
  },
): Promise<{
  commitSha: string | null;
  commitUrl: string | null;
  branch: string;
  pullRequest: { number: number; url: string } | null;
}> {
  const { filePath, sha, message, actor = 'admin', branchHint = 'delete' } = params;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const branchName = `admin/${branchHint}-${timestamp}`;
  const usePr = config.writeMode === 'pr';
  const targetBranch = usePr ? branchName : config.baseBranch;

  if (usePr) {
    await ensureBranch(config, branchName);
  }

  if (!sha) throw new Error('sha is required to delete a file');

  const commit = await githubRequest(
    config,
    `/repos/${config.owner}/${config.repo}/contents/${encodePath(filePath)}`,
    {
      method: 'DELETE',
      body: JSON.stringify({
        message: `${message}\n\nadmin-actor: ${actor}`,
        sha,
        branch: targetBranch,
      }),
    },
  );

  let pullRequest: { number: number; url: string } | null = null;
  if (usePr) {
    pullRequest = await createPullRequest(config, message, branchName, `Delete by \`${actor}\`.`);
  }

  return {
    commitSha: commit.commit?.sha || null,
    commitUrl: commit.commit?.html_url || null,
    branch: targetBranch,
    pullRequest,
  };
}
