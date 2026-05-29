import { readFile } from 'node:fs/promises';
import path from 'node:path';

function sanitizePublicPath(url) {
  if (typeof url !== 'string') throw new Error('Public data URL must be a string.');
  if (!url.startsWith('/data/')) throw new Error(`Only /data/* paths are allowed: ${url}`);
  if (url.includes('..')) throw new Error(`Invalid traversal segment in URL: ${url}`);
  return url;
}

export async function readPublicJsonFromFs(url) {
  const safeUrl = sanitizePublicPath(url);
  const filePath = path.resolve(process.cwd(), 'public', safeUrl.replace(/^\//, ''));
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw);
}
