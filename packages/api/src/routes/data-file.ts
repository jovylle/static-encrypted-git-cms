import { readEncryptedJsonFile } from '../lib/encrypted-content-store';
import type { Env } from '../helpers';

const ROOT_FILES: Record<string, string> = {
  'personal-projects.json': 'data/encrypted/personal-projects.json.enc',
  'projects.json': 'data/encrypted/projects.json.enc',
  'highlights.json': 'data/encrypted/highlights.json.enc',
  'profile.json': 'data/encrypted/profile.json.enc',
  'resume.json': 'data/encrypted/resume.json.enc',
};

function filterPublic(items: any[]): any[] {
  return items.filter((item: any) => {
    if (!item) return false;
    if (item.status === 'draft' || item.status === 'private') return false;
    if (item.private === true) return false;
    return true;
  });
}

export async function handleDataFile(
  env: Env,
  filename: string,
): Promise<Response> {
  const encPath = ROOT_FILES[filename];
  if (!encPath) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
    });
  }

  try {
    const { data } = await readEncryptedJsonFile(env, encPath);
    let result = data;

    // Filter projects array if present
    if (filename === 'personal-projects.json' && Array.isArray(data.projects)) {
      result = {
        ...data,
        projects: filterPublic(data.projects),
      };
    } else if (filename === 'projects.json' && Array.isArray(data)) {
      result = filterPublic(data);
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=300',
        'access-control-allow-origin': '*',
      },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: 'Failed to read data' }), {
      status: 500,
      headers: {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
      },
    });
  }
}
