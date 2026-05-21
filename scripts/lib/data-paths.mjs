import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '../..');

export const SOURCE_DIR = path.join(ROOT, 'data', 'source');
export const ENCRYPTED_DIR = path.join(ROOT, 'data', 'encrypted');
export const PUBLIC_DATA_DIR = path.join(ROOT, 'public', 'data');

export const SEED_REPO = path.resolve(ROOT, '../my-json-database');
export const SEED_DATA_DIR = path.join(SEED_REPO, 'public', 'data');

/** Root JSON files (relative to data/source or data/encrypted). */
export const ROOT_FILES = [
  'projects.json',
  'personal-projects.json',
  'highlights.json',
  'profile.json',
  'resume.json',
];

/** Never encrypt or export. */
export const SKIP_FILES = new Set(['function-logs.json', 'blogs/index.json']);

export function sourcePath(rel) {
  return path.join(SOURCE_DIR, rel);
}

export function encryptedPath(rel) {
  const encRel = rel.endsWith('.json') ? rel.replace(/\.json$/, '.json.enc') : rel;
  return path.join(ENCRYPTED_DIR, encRel);
}

export function listBlogSourceFiles() {
  const blogsDir = path.join(SOURCE_DIR, 'blogs');
  if (!fs.existsSync(blogsDir)) return [];
  return fs
    .readdirSync(blogsDir)
    .filter((f) => f.endsWith('.json') && f !== 'index.json')
    .map((f) => `blogs/${f}`);
}

export function listBlogEncryptedFiles() {
  const blogsDir = path.join(ENCRYPTED_DIR, 'blogs');
  if (!fs.existsSync(blogsDir)) return [];
  return fs
    .readdirSync(blogsDir)
    .filter((f) => f.endsWith('.json.enc'))
    .map((f) => `blogs/${f}`);
}

/** All logical plaintext paths under data/source. */
export function allSourcePaths() {
  const root = ROOT_FILES.map((f) => f);
  const blogs = listBlogSourceFiles();
  return [...root, ...blogs];
}

/** All encrypted paths (from source manifest or encrypted dir scan). */
export function allEncryptedPaths() {
  const root = ROOT_FILES.map((f) => f.replace(/\.json$/, '.json.enc'));
  const blogsDir = path.join(ENCRYPTED_DIR, 'blogs');
  const blogs = fs.existsSync(blogsDir)
    ? fs
        .readdirSync(blogsDir)
        .filter((f) => f.endsWith('.json.enc'))
        .map((f) => `blogs/${f}`)
    : listBlogSourceFiles().map((p) => p.replace(/\.json$/, '.json.enc'));
  return [...root, ...blogs];
}

export function encryptedToSourceRel(encRel) {
  return encRel.replace(/\.json\.enc$/, '.json');
}

export function sourceToEncryptedRel(srcRel) {
  return srcRel.replace(/\.json$/, '.json.enc');
}
