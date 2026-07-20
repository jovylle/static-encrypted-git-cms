import { Env, jsonResponse, parseJsonBody, badRequest, serverError } from '../../helpers';
import { readEncryptedJsonFile, writeEncryptedJsonFile } from '../../lib/encrypted-content-store';
import { getGithubConfig, deleteRepoFile } from '../../lib/github-content';
import { validateCollectionData } from '../../lib/validate-collection';

const NOTIFICATIONS_DIR = 'data/encrypted/notifications';

function notificationFilePath(slug: string): string {
  const safe = String(slug || '').trim();
  if (!/^(?:pinned|\d{4}-\d{2}-\d{2})$/.test(safe)) {
    throw new Error('slug must be pinned or YYYY-MM-DD');
  }
  return `${NOTIFICATIONS_DIR}/${safe}.json.enc`;
}

export async function handleAdminNotificationGet(env: Env, slug: string): Promise<Response> {
  try {
    if (!slug) return badRequest('slug is required');
    const filePath = notificationFilePath(slug);
    const file = await readEncryptedJsonFile(env, filePath, null);
    if (!file.exists) {
      return jsonResponse({ error: 'Notification bundle not found', slug }, 404);
    }
    return jsonResponse({ ok: true, slug, data: file.data });
  } catch (e: any) {
    if (e.message.includes('slug must be')) return badRequest(e.message);
    return serverError(e.message);
  }
}

export async function handleAdminNotificationPost(
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

    const filePath = notificationFilePath(slug);
    if (!Array.isArray(body.data.notifications)) {
      return badRequest('data.notifications must be an array');
    }

    const validation = await validateCollectionData('notification-bundle', body.data);
    if (!validation.ok) {
      return jsonResponse({ error: 'Validation failed', validationErrors: validation.errors }, 400);
    }

    const existing = await readEncryptedJsonFile(env, filePath, null);
    const write = await writeEncryptedJsonFile(env, {
      filePath,
      data: body.data,
      sha: existing.sha,
      actor: adminUser,
      branchHint: `notification-${slug}`,
      message: `admin: update notifications ${slug}`,
    });

    return jsonResponse({ ok: true, slug, write });
  } catch (e: any) {
    if (e.message.includes('slug must be')) return badRequest(e.message);
    return serverError(e.message);
  }
}

export async function handleAdminNotificationDelete(
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
    const filePath = notificationFilePath(slug);
    const existing = await readEncryptedJsonFile(env, filePath, null);
    if (!existing.exists) return badRequest(`Notification bundle not found: ${slug}`);
    if (!existing.sha) return serverError('No SHA for file');

    const config = getGithubConfig(env);
    const write = await deleteRepoFile(config, {
      filePath,
      sha: existing.sha,
      message: `admin: delete notifications ${slug}`,
      actor: adminUser,
      branchHint: `notification-delete-${slug}`,
    });

    return jsonResponse({ ok: true, slug, write });
  } catch (e: any) {
    if (e.message.includes('slug must be') || e.message.includes('not found')) {
      return badRequest(e.message);
    }
    return serverError(e.message);
  }
}
