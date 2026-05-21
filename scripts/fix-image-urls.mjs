import fs from 'fs';
import path from 'path';
import { SOURCE_DIR, ROOT_FILES } from './lib/data-paths.mjs';
import { loadDotEnv, readFileIfExists, writeJsonFile } from './lib/data-io.mjs';
import { getContentAssetBase, transformAssetUrls } from './lib/asset-urls.mjs';

loadDotEnv();

const base = getContentAssetBase();

function fixFile(relPath) {
  const full = path.join(SOURCE_DIR, relPath);
  const text = readFileIfExists(full);
  if (text === null) return false;
  const data = JSON.parse(text);
  const next = transformAssetUrls(data, base);
  writeJsonFile(full, next);
  console.log(`Fixed asset URLs: ${relPath}`);
  return true;
}

if (!fs.existsSync(SOURCE_DIR)) {
  console.error('data/source/ not found. Run: npm run data:decrypt');
  process.exit(1);
}

let count = 0;
for (const filename of ROOT_FILES) {
  if (fixFile(filename)) count++;
}

const blogsDir = path.join(SOURCE_DIR, 'blogs');
if (fs.existsSync(blogsDir)) {
  for (const f of fs.readdirSync(blogsDir)) {
    if (!f.endsWith('.json') || f === 'index.json') continue;
    if (fixFile(`blogs/${f}`)) count++;
  }
}

console.log(`Done. Updated ${count} file(s) → ${base}/images/...`);
console.log('Next: npm run data:encrypt');
