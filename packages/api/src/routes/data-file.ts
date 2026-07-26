import { readEncryptedJsonFile } from '../lib/encrypted-content-store';
import { getGithubConfig, listRepoDirectory } from '../lib/github-content';
import type { Env } from '../helpers';

const ROOT_FILES: Record<string, string> = {
  'personal-projects.json': 'data/encrypted/personal-projects.json.enc',
  'projects.json': 'data/encrypted/projects.json.enc',
  'highlights.json': 'data/encrypted/highlights.json.enc',
  'profile.json': 'data/encrypted/profile.json.enc',
  'resume.json': 'data/encrypted/resume.json.enc',
  'homepage.json': 'data/encrypted/homepage.json.enc',
  'social.json': 'data/encrypted/social.json.enc',
  'uses.json': 'data/encrypted/uses.json.enc',
  'fast-scores.json': 'data/encrypted/fast-scores.json.enc',
};

const BLOGS_DIR = 'data/encrypted/blogs';
const NOTIFICATIONS_DIR = 'data/encrypted/notifications';

function filterPublic(items: any[]): any[] {
  return items.filter((item: any) => {
    if (!item) return false;
    if (item.status === 'draft' || item.status === 'private') return false;
    if (item.private === true) return false;
    return true;
  });
}

function jsonOk(body: any, maxAge = 300): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${maxAge}`,
      'access-control-allow-origin': '*',
    },
  });
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  });
}

function slugFromEncName(name: string): string {
  return String(name || '').replace(/\.json\.enc$/, '');
}

function isDraft(data: any): boolean {
  if (!data) return true;
  if (data.status === 'draft' || data.status === 'private') return true;
  if (data.private === true) return true;
  if (data.draft === true) return true;
  return false;
}

function summarizeBlogPost(slug: string, data: any): any {
  return {
    slug,
    title: data?.title || slug,
    date: data?.date || '',
    excerpt: data?.excerpt || '',
    tags: data?.tags || [],
    featured: data?.featured === true,
  };
}

function summarizeNotificationBundle(slug: string, data: any): any {
  const items = Array.isArray(data?.notifications) ? data.notifications : [];
  const published = items.filter((n: any) => n.status !== 'draft');
  const first = published[0] || items[0];
  return {
    slug,
    title: first?.title || slug,
    count: published.length,
    date: slug === 'pinned' ? '' : slug,
  };
}

// ── Root single-file collections ──

export async function handleDataFile(
  env: Env,
  filename: string,
): Promise<Response> {
  const encPath = ROOT_FILES[filename];
  if (!encPath) return jsonError(404, 'Not found');

  try {
    const { data } = await readEncryptedJsonFile(env, encPath);
    let result = data;

    if (filename === 'personal-projects.json' && Array.isArray(data.projects)) {
      result = { ...data, projects: filterPublic(data.projects) };
    } else if (filename === 'projects.json' && Array.isArray(data)) {
      result = filterPublic(data);
    }

    return jsonOk(result);
  } catch (e: any) {
    return jsonError(500, 'Failed to read data');
  }
}

// ── Blog index (list all published posts) ──

export async function handleBlogIndex(env: Env): Promise<Response> {
  try {
    const config = getGithubConfig(env);
    const entries = await listRepoDirectory(config, BLOGS_DIR);
    const encFiles = entries.filter((e) => e.name.endsWith('.json.enc'));

    const posts = await Promise.all(
      encFiles.map(async (entry) => {
        const slug = slugFromEncName(entry.name);
        try {
          const { data } = await readEncryptedJsonFile(env, `${BLOGS_DIR}/${entry.name}`);
          if (isDraft(data)) return null;
          return summarizeBlogPost(slug, data);
        } catch {
          return null;
        }
      }),
    );

    const published = posts
      .filter(Boolean)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    return jsonOk({ posts: published });
  } catch (e: any) {
    return jsonError(500, 'Failed to read blog index');
  }
}

// ── Single blog post ──

export async function handleBlogPost(env: Env, slug: string): Promise<Response> {
  const filePath = `${BLOGS_DIR}/${slug}.json.enc`;
  try {
    const { data } = await readEncryptedJsonFile(env, filePath);
    if (isDraft(data)) return jsonError(404, 'Not found');
    return jsonOk(data);
  } catch (e: any) {
    if (e.message?.includes('not found')) return jsonError(404, 'Not found');
    return jsonError(500, 'Failed to read blog post');
  }
}

// ── Notifications index (list all bundles) ──

export async function handleNotificationsIndex(env: Env): Promise<Response> {
  try {
    const config = getGithubConfig(env);
    const entries = await listRepoDirectory(config, NOTIFICATIONS_DIR);
    const encFiles = entries.filter((e) => e.name.endsWith('.json.enc'));

    const bundles = await Promise.all(
      encFiles.map(async (entry) => {
        const slug = slugFromEncName(entry.name);
        try {
          const { data } = await readEncryptedJsonFile(env, `${NOTIFICATIONS_DIR}/${entry.name}`);
          return summarizeNotificationBundle(slug, data);
        } catch {
          return null;
        }
      }),
    );

    const sorted = bundles
      .filter(Boolean)
      .sort((a, b) => (b.date || b.slug).localeCompare(a.date || a.slug));

    return jsonOk({ notifications: sorted });
  } catch (e: any) {
    return jsonError(500, 'Failed to read notifications index');
  }
}

// ── Single notification bundle ──

export async function handleNotificationBundle(env: Env, slug: string): Promise<Response> {
  const filePath = `${NOTIFICATIONS_DIR}/${slug}.json.enc`;
  try {
    const { data } = await readEncryptedJsonFile(env, filePath);
    return jsonOk(data);
  } catch (e: any) {
    if (e.message?.includes('not found')) return jsonError(404, 'Not found');
    return jsonError(500, 'Failed to read notification bundle');
  }
}
