function parseRepo(repoText) {
  const [owner, repo] = String(repoText || '').split('/');
  if (!owner || !repo) {
    throw new Error('GITHUB_REPO must be set as "owner/repo".');
  }
  return { owner, repo };
}

function getGithubConfig() {
  const token = process.env.GITHUB_TOKEN || '';
  if (!token) throw new Error('GITHUB_TOKEN is required for admin writeback.');
  const repoText = process.env.GITHUB_REPO || 'jovylle/static-encrypted-git-cms';
  const baseBranch = process.env.GITHUB_BRANCH || 'master';
  const writeMode = process.env.ADMIN_GITHUB_WRITE_MODE || 'commit';
  const { owner, repo } = parseRepo(repoText);
  return { token, owner, repo, baseBranch, writeMode };
}

async function githubRequest(config, endpoint, options = {}) {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${config.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const detail = await res.text();
    const err = new Error(`GitHub API ${res.status}: ${detail}`);
    err.status = res.status;
    throw err;
  }

  if (res.status === 204) return null;
  return res.json();
}

function toGithubContent(text) {
  return Buffer.from(text, 'utf8').toString('base64');
}

function encodePath(filePath) {
  return String(filePath)
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function fromGithubContent(encoded) {
  return Buffer.from(String(encoded || '').replace(/\n/g, ''), 'base64').toString(
    'utf8',
  );
}

async function ensureBranch(config, branchName) {
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
  } catch (e) {
    if (e.status !== 422) throw e;
  }
}

async function createPullRequest(config, title, branchName, body) {
  const pr = await githubRequest(config, `/repos/${config.owner}/${config.repo}/pulls`, {
    method: 'POST',
    body: JSON.stringify({
      title,
      head: branchName,
      base: config.baseBranch,
      body,
    }),
  });
  return {
    number: pr.number,
    url: pr.html_url,
  };
}

export async function getRepoTextFile(filePath, ref = null) {
  const config = getGithubConfig();
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  const endpoint = `/repos/${config.owner}/${config.repo}/contents/${encodePath(filePath)}${query}`;

  try {
    const json = await githubRequest(config, endpoint);
    if (Array.isArray(json)) {
      return { entries: json, exists: true };
    }
    return { text: fromGithubContent(json.content), sha: json.sha, exists: true };
  } catch (e) {
    if (e.status === 404) return { text: null, sha: null, exists: false, entries: null };
    throw e;
  }
}

/** List files in a repo directory (non-recursive). Returns [] if missing. */
export async function listRepoDirectory(dirPath, ref = null) {
  const result = await getRepoTextFile(dirPath, ref);
  if (!result.exists) return [];
  if (!Array.isArray(result.entries)) {
    throw new Error(`Path is not a directory: ${dirPath}`);
  }
  return result.entries
    .filter((entry) => entry.type === 'file')
    .map((entry) => ({
      name: entry.name,
      path: entry.path,
      sha: entry.sha,
    }));
}

export async function writeRepoTextFile({
  filePath,
  content,
  message,
  actor = 'admin',
  branchHint = 'visibility-update',
  previousSha = undefined,
}) {
  const config = getGithubConfig();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const branchName = `admin/${branchHint}-${timestamp}`;
  const usePr = config.writeMode === 'pr';
  const targetBranch = usePr ? branchName : config.baseBranch;

  if (usePr) {
    await ensureBranch(config, branchName);
  }

  const commitBody = {
    message: `${message}\n\nadmin-actor: ${actor}`,
    content: toGithubContent(content),
    branch: targetBranch,
  };
  if (previousSha) commitBody.sha = previousSha;

  const commit = await githubRequest(
    config,
    `/repos/${config.owner}/${config.repo}/contents/${encodePath(filePath)}`,
    {
      method: 'PUT',
      body: JSON.stringify(commitBody),
    },
  );

  let pullRequest = null;
  if (usePr) {
    const prTitle = message;
    const prBody = `Automated admin visibility update by \`${actor}\`.`;
    pullRequest = await createPullRequest(config, prTitle, branchName, prBody);
  }

  return {
    commitSha: commit.commit?.sha || null,
    commitUrl: commit.commit?.html_url || null,
    branch: targetBranch,
    pullRequest,
  };
}

export async function deleteRepoFile({
  filePath,
  sha,
  message,
  actor = 'admin',
  branchHint = 'delete',
}) {
  const config = getGithubConfig();
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

  let pullRequest = null;
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
