import { Env, jsonResponse, serverError } from '../../helpers';
import { getAdminCollectionByKey } from '../../lib/admin-collections';
import { readEncryptedJsonFile } from '../../lib/encrypted-content-store';
import { getGithubConfig, listRepoDirectory } from '../../lib/github-content';

const BLOGS_DIR = 'data/encrypted/blogs';

function slugFromEncName(name: string): string {
  return String(name || '').replace(/\.json\.enc$/, '');
}

function summarizeBlogPost(slug: string, data: any): any {
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

export async function handleAdminBlogs(env: Env): Promise<Response> {
  const collection = getAdminCollectionByKey('blogs');
  if (!collection?.multiFile) return serverError('Blog collection is not configured');

  try {
    const config = getGithubConfig(env);
    const entries = await listRepoDirectory(config, BLOGS_DIR);
    const encFiles = entries.filter((entry) => entry.name.endsWith('.json.enc'));

    const posts = await Promise.all(
      encFiles.map(async (entry) => {
        const slug = slugFromEncName(entry.name);
        const filePath = `${BLOGS_DIR}/${entry.name}`;
        try {
          const { data } = await readEncryptedJsonFile(env, filePath);
          return summarizeBlogPost(slug, data);
        } catch {
          return summarizeBlogPost(slug, null);
        }
      }),
    );

    posts.sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.slug.localeCompare(b.slug));

    return jsonResponse({
      ok: true,
      collection: { key: collection.key, label: collection.label },
      posts,
    });
  } catch (e: any) {
    return serverError(e.message);
  }
}
