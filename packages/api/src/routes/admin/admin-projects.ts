import { Env, jsonResponse, serverError } from '../../helpers';
import { readEncryptedJsonFile } from '../../lib/encrypted-content-store';
import { getGithubConfig, listRepoDirectory } from '../../lib/github-content';
import { normalizePublishControls } from '../../lib/visibility-mutators';

const BLOGS_DIR = 'data/encrypted/blogs';
const NOTIFICATIONS_DIR = 'data/encrypted/notifications';

export async function handleAdminProjects(env: Env): Promise<Response> {
  try {
    const [
      { data: personal },
      controlsFile,
      notificationEntries,
      blogEntries,
    ] = await Promise.all([
      readEncryptedJsonFile(env, 'data/encrypted/personal-projects.json.enc'),
      readEncryptedJsonFile(env, 'data/encrypted/publish-controls.json.enc', {
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
      (async () => {
        const config = getGithubConfig(env);
        return listRepoDirectory(config, NOTIFICATIONS_DIR).catch(() => []);
      })(),
      (async () => {
        const config = getGithubConfig(env);
        return listRepoDirectory(config, BLOGS_DIR).catch(() => []);
      })(),
    ]);

    const controls = normalizePublishControls(controlsFile.data);
    const projects = Array.isArray(personal.projects)
      ? personal.projects.map((p: any) => ({
          slug: p.slug,
          title: p.title,
          status: p.status,
          private: p.private === true,
          updated_at: p.updated_at,
        }))
      : [];

    const notifications: any[] = [];
    const encNotificationFiles = notificationEntries.filter((entry: any) =>
      entry.name?.endsWith('.json.enc'),
    );
    for (const entry of encNotificationFiles) {
      try {
        const { data } = await readEncryptedJsonFile(
          env,
          `${NOTIFICATIONS_DIR}/${entry.name}`,
        );
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

    const blogCount = blogEntries.filter((entry: any) =>
      entry.name?.endsWith('.json.enc'),
    ).length;

    return jsonResponse({
      ok: true,
      controls,
      projects,
      notifications,
      blogCount,
    });
  } catch (e: any) {
    return serverError(e.message);
  }
}
