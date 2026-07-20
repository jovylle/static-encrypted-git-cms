import { Env, jsonResponse, parseJsonBody, badRequest, serverError } from '../../helpers';
import { readEncryptedJsonFile, writeEncryptedJsonFile } from '../../lib/encrypted-content-store';
import { fetchRepoCreatedAt } from '../../lib/github-repo-meta';

function normalizeDirection(value: string): string | null {
  if (value === 'asc' || value === 'desc') return value;
  return null;
}

export async function handleAdminSortPersonalProjects(
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

  try {
    const direction = normalizeDirection(body?.direction || 'desc');
    if (!direction) return badRequest('direction must be "asc" or "desc"');

    const { data, sha } = await readEncryptedJsonFile(
      env,
      'data/encrypted/personal-projects.json.enc',
    );
    if (!Array.isArray(data?.projects)) {
      return badRequest('personal-projects.json must contain projects array');
    }

    const token = env.GITHUB_TOKEN || '';
    const cache = new Map<string, Promise<string | null>>();
    const projects = [...data.projects];

    const withCreated = await Promise.all(
      projects.map(async (project: any) => {
        const repoUrl = project?.repo || '';
        if (!cache.has(repoUrl)) {
          cache.set(repoUrl, fetchRepoCreatedAt(token, repoUrl).catch(() => null));
        }
        const createdAt = await cache.get(repoUrl);
        return { ...project, __repo_created_at: createdAt || null };
      }),
    );

    withCreated.sort((a: any, b: any) => {
      const aTime = a.__repo_created_at || '';
      const bTime = b.__repo_created_at || '';
      if (aTime && bTime) {
        return direction === 'asc'
          ? aTime.localeCompare(bTime)
          : bTime.localeCompare(aTime);
      }
      if (aTime) return direction === 'asc' ? 1 : -1;
      if (bTime) return direction === 'asc' ? -1 : 1;
      return (b.updated_at || '').localeCompare(a.updated_at || '');
    });

    const cleaned = withCreated.map((project: any) => {
      const out = { ...project };
      delete out.__repo_created_at;
      return out;
    });

    const write = await writeEncryptedJsonFile(env, {
      filePath: 'data/encrypted/personal-projects.json.enc',
      data: { ...data, projects: cleaned },
      sha,
      actor: adminUser,
      branchHint: 'personal-projects-created-sort',
      message: `admin: sort personal projects by repo creation date (${direction})`,
    });

    return jsonResponse({
      ok: true,
      direction,
      sortedCount: cleaned.length,
      write,
    });
  } catch (e: any) {
    return serverError(e.message);
  }
}
