import { getGithubConfig, getRepoRawFile } from '../lib/github-content';
import type { Env } from '../helpers';

// Public, unauthenticated route — live-serves raw image bytes from
// `public/images/**` in the content repo via the GitHub Contents API.
//
// SECURITY: `path` is attacker-controlled (whatever came after `/images/` in
// the URL) and gets concatenated into a GitHub Contents API file path. This
// function is the second of two independent defense layers (the router's
// regex pattern is the first) — it must reject anything that could escape
// the `public/images/` prefix even if called directly, bypassing the router.

const IMAGES_DIR = 'public/images';

// Deliberately explicit — do not trust any content-type coming back from
// GitHub or from the request; derive it ourselves from the validated
// extension only.
const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

// Only these characters may appear anywhere in the path. No '%' (so a caller
// can never smuggle an encoded ".." past this check), no backslash.
const ALLOWED_CHARS_RE = /^[a-zA-Z0-9._\-/]+$/;
const ALLOWED_EXTENSION_RE = /\.(png|jpe?g|gif|webp|svg)$/i;

function isSafeImagePath(path: string): boolean {
  if (!path) return false;
  if (path.includes('..')) return false;
  if (path.startsWith('/')) return false;
  if (path.includes('\\')) return false;
  if (!ALLOWED_CHARS_RE.test(path)) return false;
  if (!ALLOWED_EXTENSION_RE.test(path)) return false;
  return true;
}

function extensionOf(path: string): string {
  const match = /\.[a-z0-9]+$/i.exec(path);
  return match ? match[0].toLowerCase() : '';
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  });
}

export async function handleImageFile(env: Env, path: string): Promise<Response> {
  const safePath = String(path || '');

  if (!isSafeImagePath(safePath)) {
    return jsonError(400, 'Invalid image path');
  }

  const contentType = CONTENT_TYPES[extensionOf(safePath)];
  if (!contentType) {
    return jsonError(400, 'Invalid image path');
  }

  const filePath = `${IMAGES_DIR}/${safePath}`;

  try {
    const config = getGithubConfig(env);
    const { bytes, exists } = await getRepoRawFile(config, filePath);
    if (!exists || !bytes) {
      return jsonError(404, 'Not found');
    }

    return new Response(bytes, {
      status: 200,
      headers: {
        'content-type': contentType,
        'cache-control': 'public, max-age=3600',
        'access-control-allow-origin': '*',
      },
    });
  } catch (e: any) {
    return jsonError(500, 'Failed to read image');
  }
}
