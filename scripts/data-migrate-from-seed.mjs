import fs from 'fs';
import path from 'path';
import {
  ROOT,
  SEED_DATA_DIR,
  SEED_REPO,
  SOURCE_DIR,
  ROOT_FILES,
  SKIP_FILES,
} from './lib/data-paths.mjs';
import { copyFileSafe, copyDirRecursive, ensureDir } from './lib/data-io.mjs';

const imagesSeedRoot = path.join(SEED_REPO, 'public', 'images');
const imagesDestRoot = path.join(ROOT, 'public', 'images');

if (!fs.existsSync(SEED_DATA_DIR)) {
  console.error(`Seed not found: ${SEED_DATA_DIR}`);
  console.error('Expected my-json-database at:', SEED_REPO);
  process.exit(1);
}

ensureDir(SOURCE_DIR);
ensureDir(path.join(SOURCE_DIR, 'blogs'));

let copied = 0;
for (const filename of ROOT_FILES) {
  if (SKIP_FILES.has(filename)) continue;
  const src = path.join(SEED_DATA_DIR, filename);
  const dest = path.join(SOURCE_DIR, filename);
  if (copyFileSafe(src, dest)) {
    copied++;
    console.log(`Copied: ${filename}`);
  }
}

const seedBlogs = path.join(SEED_DATA_DIR, 'blogs');
if (fs.existsSync(seedBlogs)) {
  for (const f of fs.readdirSync(seedBlogs)) {
    if (!f.endsWith('.json') || f === 'index.json') continue;
    const src = path.join(seedBlogs, f);
    const dest = path.join(SOURCE_DIR, 'blogs', f);
    if (copyFileSafe(src, dest)) {
      copied++;
      console.log(`Copied: blogs/${f}`);
    }
  }
}

if (fs.existsSync(imagesSeedRoot)) {
  copyDirRecursive(imagesSeedRoot, imagesDestRoot);
  console.log('Copied public/images/ (root + post/)');
}

console.log(`Migration complete. ${copied} data file(s) in data/source/.`);
console.log('Next: set CONTENT_DECRYPT_KEY in .env, then npm run data:encrypt');
