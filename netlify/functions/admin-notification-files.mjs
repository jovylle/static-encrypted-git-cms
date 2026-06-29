import { getAuthenticatedAdmin } from './lib/admin-auth.mjs';
import { getAdminCollectionByKey } from './lib/admin-collections.mjs';
import { readEncryptedJsonFile } from './lib/encrypted-content-store.mjs';
import { listRepoDirectory } from './lib/github-content.mjs';
import { jsonResponse, methodNotAllowed, serverError, unauthorized } from './lib/http.mjs';

const NOTIFICATIONS_DIR = 'data/encrypted/notifications';

function slugFromEncName(name) {
  return String(name || '').replace(/\.json\.enc$/, '');
}

function summarizeBundle(slug, data) {
  const items = Array.isArray(data?.notifications) ? data.notifications : [];
  const first = items[0];
  return {
    slug,
    title: first?.title || slug,
    count: items.length,
    date: slug === 'pinned' ? '' : slug,
    status: items.some((n) => n.status === 'published') ? 'published' : 'draft',
  };
}

export async function handler(event) {
  if (event.httpMethod !== 'GET') return methodNotAllowed('GET');

  const admin = getAuthenticatedAdmin(event.headers);
  if (!admin) return unauthorized();

  const collection = getAdminCollectionByKey('notifications');
  if (!collection?.multiFile) return serverError('Notifications collection is not configured');

  try {
    const entries = await listRepoDirectory(NOTIFICATIONS_DIR);
    const encFiles = entries.filter((entry) => entry.name.endsWith('.json.enc'));

    const bundles = await Promise.all(
      encFiles.map(async (entry) => {
        const slug = slugFromEncName(entry.name);
        const filePath = `${NOTIFICATIONS_DIR}/${entry.name}`;
        try {
          const { data } = await readEncryptedJsonFile(filePath);
          return summarizeBundle(slug, data);
        } catch {
          return summarizeBundle(slug, null);
        }
      }),
    );

    bundles.sort(
      (a, b) =>
        (b.date || b.slug).localeCompare(a.date || a.slug) || a.slug.localeCompare(b.slug),
    );

    return jsonResponse(200, {
      ok: true,
      collection: { key: collection.key, label: collection.label },
      bundles,
    });
  } catch (e) {
    return serverError(e.message);
  }
}
