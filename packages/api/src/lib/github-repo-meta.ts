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
