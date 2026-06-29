import { getAuthenticatedAdmin } from './lib/admin-auth.mjs';
import { readEncryptedJsonFile } from './lib/encrypted-content-store.mjs';
import { listRepoDirectory } from './lib/github-content.mjs';
import { jsonResponse, methodNotAllowed, serverError, unauthorized } from './lib/http.mjs';
import { normalizePublishControls } from './lib/visibility-mutators.mjs';

const BLOGS_DIR = 'data/encrypted/blogs';
const NOTIFICATIONS_DIR = 'data/encrypted/notifications';

export async function handler(event) {
  if (event.httpMethod !== 'GET') return methodNotAllowed('GET');
  const admin = getAuthenticatedAdmin(event.headers);
  if (!admin) return unauthorized();

  try {
    const [{ data: personal }, controlsFile, notificationEntries, blogEntries] = await Promise.all([
      readEncryptedJsonFile('data/encrypted/personal-projects.json.enc'),
      readEncryptedJsonFile('data/encrypted/publish-controls.json.enc', {
        collections: {
          'personal-projects': 'public',
          projects: 'public',
          highlights: 'public',
          profile: 'public',
          resume: 'public',
          blogs: 'public',
          notifications: 'public',
        },
      }),
      listRepoDirectory(NOTIFICATIONS_DIR).catch(() => []),
      listRepoDirectory(BLOGS_DIR).catch(() => []),
    ]);

    const controls = normalizePublishControls(controlsFile.data);
    const projects = Array.isArray(personal.projects)
      ? personal.projects.map((p) => ({
          slug: p.slug,
          title: p.title,
          status: p.status,
          private: p.private === true,
          updated_at: p.updated_at,
        }))
      : [];

    const notifications = [];
    const encNotificationFiles = notificationEntries.filter((entry) =>
      entry.name?.endsWith('.json.enc'),
    );
    for (const entry of encNotificationFiles) {
      try {
        const { data } = await readEncryptedJsonFile(`${NOTIFICATIONS_DIR}/${entry.name}`);
        for (const n of data?.notifications || []) {
          notifications.push({
            id: n.id,
            title: n.title,
            status: n.status,
            private: n.private === true,
            date: n.date || '',
          });
        }
      } catch {
        // skip unreadable bundle
      }
    }
    notifications.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    const blogCount = blogEntries.filter((entry) => entry.name?.endsWith('.json.enc')).length;

    return jsonResponse(200, {
      ok: true,
      controls,
      projects,
      notifications,
      blogCount,
    });
  } catch (e) {
    return serverError(e.message);
  }
}
