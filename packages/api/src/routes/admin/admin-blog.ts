import { Env, jsonResponse, parseJsonBody, badRequest, serverError } from '../../helpers';
import { readEncryptedJsonFile, writeEncryptedJsonFile } from '../../lib/encrypted-content-store';
import { getGithubConfig, deleteRepoFile } from '../../lib/github-content';
import { validateCollectionData } from '../../lib/validate-collection';

const BLOGS_DIR = 'data/encrypted/blogs';

function blogFilePath(slug: string): string {
  const safe = String(slug || '').trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(safe)) {
    throw new Error('slug must be lowercase letters, numbers, and hyphens');
  }
  return `${BLOGS_DIR}/${safe}.json.enc`;
}

export async function handleAdminBlogGet(env: Env, slug: string): Promise<Response> {
  try {
    if (!slug) return badRequest('slug is required');
    const filePath = blogFilePath(slug);
    const file = await readEncryptedJsonFile(env, filePath, null);
    if (!file.exists) {
      return jsonResponse({ error: 'Blog post not found', slug }, 404);
    }
    return jsonResponse({ ok: true, slug, data: file.data });
  } catch (e: any) {
    if (e.message.includes('slug must be')) return badRequest(e.message);
    return serverError(e.message);
  }
}

export async function handleAdminBlogPost(
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
    const slug = String(body.slug || '').trim();
    if (!slug) return badRequest('slug is required');
    if (body.data === undefined) return badRequest('data is required');

    const filePath = blogFilePath(slug);
    if (body.data.slug && body.data.slug !== slug) {
      return badRequest('data.slug must match slug in request');
    }
    body.data.slug = slug;

    const validation = await validateCollectionData('blog-post', body.data);
    if (!validation.ok) {
      return jsonResponse({ error: 'Validation failed', validationErrors: validation.errors }, 400);
    }

    const existing = await readEncryptedJsonFile(env, filePath, null);
    const write = await writeEncryptedJsonFile(env, {
      filePath,
      data: body.data,
      sha: existing.sha,
      actor: adminUser,
      branchHint: `blog-${slug}`,
      message: `admin: update blog ${slug}`,
    });

    return jsonResponse({ ok: true, slug, write });
  } catch (e: any) {
    if (e.message.includes('slug must be')) return badRequest(e.message);
    return serverError(e.message);
  }
}

export async function handleAdminBlogDelete(
  env: Env,
  request: Request,
  adminUser: string,
  slugParam?: string,
): Promise<Response> {
  let slug = slugParam || '';
  if (request.method === 'DELETE') {
    try {
      const body = await parseJsonBody<Record<string, any>>(request);
      if (body.slug) slug = String(body.slug);
    } catch {}
  }

  if (!slug) return badRequest('slug is required');

  try {
    const filePath = blogFilePath(slug);
    const existing = await readEncryptedJsonFile(env, filePath, null);
    if (!existing.exists) return badRequest(`Blog post not found: ${slug}`);
    if (!existing.sha) return serverError('No SHA for file');

    const config = getGithubConfig(env);
    const write = await deleteRepoFile(config, {
      filePath,
      sha: existing.sha,
      message: `admin: delete blog ${slug}`,
      actor: adminUser,
      branchHint: `blog-delete-${slug}`,
    });

    return jsonResponse({ ok: true, slug, write });
  } catch (e: any) {
    if (e.message.includes('slug must be') || e.message.includes('not found')) {
      return badRequest(e.message);
    }
    return serverError(e.message);
  }
}
