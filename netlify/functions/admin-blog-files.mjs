import { getAuthenticatedAdmin } from './lib/admin-auth.mjs';
import { getAdminCollectionByKey } from './lib/admin-collections.mjs';
import { readEncryptedJsonFile } from './lib/encrypted-content-store.mjs';
import { listRepoDirectory } from './lib/github-content.mjs';
import { jsonResponse, methodNotAllowed, serverError, unauthorized } from './lib/http.mjs';

const BLOGS_DIR = 'data/encrypted/blogs';

function slugFromEncName(name) {
  return String(name || '').replace(/\.json\.enc$/, '');
}

function summarizeBlogPost(slug, data) {
  return {
    slug,
    title: data?.title || slug,
    status: data?.status || 'draft',
    private: data?.private === true,
    date: data?.date || '',
    featured: data?.featured === true,
    excerpt: data?.excerpt || '',
  };
}

export async function handler(event) {
  if (event.httpMethod !== 'GET') return methodNotAllowed('GET');

  const admin = getAuthenticatedAdmin(event.headers);
  if (!admin) return unauthorized();

  const collection = getAdminCollectionByKey('blogs');
  if (!collection?.multiFile) return serverError('Blog collection is not configured');

  try {
    const entries = await listRepoDirectory(BLOGS_DIR);
    const encFiles = entries.filter((entry) => entry.name.endsWith('.json.enc'));

    const posts = await Promise.all(
      encFiles.map(async (entry) => {
        const slug = slugFromEncName(entry.name);
        const filePath = `${BLOGS_DIR}/${entry.name}`;
        try {
          const { data } = await readEncryptedJsonFile(filePath);
          return summarizeBlogPost(slug, data);
        } catch {
          return summarizeBlogPost(slug, null);
        }
      }),
    );

    posts.sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.slug.localeCompare(b.slug));

    return jsonResponse(200, {
      ok: true,
      collection: { key: collection.key, label: collection.label },
      posts,
    });
  } catch (e) {
    return serverError(e.message);
  }
}
