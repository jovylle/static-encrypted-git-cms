import { Env, jsonResponse, serverError } from '../../helpers';
import { getAdminCollectionByKey } from '../../lib/admin-collections';
import { readEncryptedJsonFile } from '../../lib/encrypted-content-store';
import { getGithubConfig, listRepoDirectory } from '../../lib/github-content';

const NOTIFICATIONS_DIR = 'data/encrypted/notifications';

function slugFromEncName(name: string): string {
  return String(name || '').replace(/\.json\.enc$/, '');
}

function summarizeBundle(slug: string, data: any): any {
  const items = Array.isArray(data?.notifications) ? data.notifications : [];
  const first = items[0];
  return {
    slug,
    title: first?.title || slug,
    count: items.length,
    date: slug === 'pinned' ? '' : slug,
    status: items.some((n: any) => n.status === 'published') ? 'published' : 'draft',
  };
}

export async function handleAdminNotifications(env: Env): Promise<Response> {
  const collection = getAdminCollectionByKey('notifications');
  if (!collection?.multiFile) return serverError('Notifications collection is not configured');

  try {
    const config = getGithubConfig(env);
    const entries = await listRepoDirectory(config, NOTIFICATIONS_DIR);
    const encFiles = entries.filter((entry) => entry.name.endsWith('.json.enc'));

    const bundles = await Promise.all(
      encFiles.map(async (entry) => {
        const slug = slugFromEncName(entry.name);
        const filePath = `${NOTIFICATIONS_DIR}/${entry.name}`;
        try {
          const { data } = await readEncryptedJsonFile(env, filePath);
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

    return jsonResponse({
      ok: true,
      collection: { key: collection.key, label: collection.label },
      bundles,
    });
  } catch (e: any) {
    return serverError(e.message);
  }
}
