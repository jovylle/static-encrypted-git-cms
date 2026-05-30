import { getAuthenticatedAdmin } from './lib/admin-auth.mjs';
import { readEncryptedJsonFile } from './lib/encrypted-content-store.mjs';
import { listRepoDirectory } from './lib/github-content.mjs';
import { jsonResponse, methodNotAllowed, serverError, unauthorized } from './lib/http.mjs';
import { normalizePublishControls } from './lib/visibility-mutators.mjs';

const BLOGS_DIR = 'data/encrypted/blogs';

export async function handler(event) {
  if (event.httpMethod !== 'GET') return methodNotAllowed('GET');
  const admin = getAuthenticatedAdmin(event.headers);
  if (!admin) return unauthorized();

  try {
    const [{ data: personal }, controlsFile, notificationsFile, blogEntries] = await Promise.all([
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
      readEncryptedJsonFile('data/encrypted/notifications.json.enc', { notifications: [] }),
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

    const notifications = Array.isArray(notificationsFile.data?.notifications)
      ? notificationsFile.data.notifications.map((n) => ({
          id: n.id,
          title: n.title,
          status: n.status,
          private: n.private === true,
          date: n.date,
        }))
      : [];

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
