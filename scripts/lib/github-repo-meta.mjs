function parseGithubRepoUrl(repoUrl) {
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

function githubHeaders() {
  const token = process.env.GITHUB_TOKEN || '';
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'static-encrypted-cms',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function fetchRepoCreatedAt(repoUrl) {
  const ref = parseGithubRepoUrl(repoUrl);
  if (!ref) return null;

  const res = await fetch(`https://api.github.com/repos/${ref.owner}/${ref.repo}`, {
    method: 'GET',
    headers: githubHeaders(),
  });
  if (!res.ok) return null;

  const json = await res.json().catch(() => null);
  return json?.created_at || null;
}
