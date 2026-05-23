import fs from 'fs';
import path from 'path';
import { encryptJson } from './lib/content-crypto.mjs';
import {
  SOURCE_DIR,
  ENCRYPTED_DIR,
  allSourcePaths,
  sourcePath,
  encryptedPath,
} from './lib/data-paths.mjs';
import { loadDotEnv, ensureDir, readFileIfExists } from './lib/data-io.mjs';
import { validateSourceData } from './lib/validate-data.mjs';

loadDotEnv();

const { ok, errors } = await validateSourceData();
if (!ok) {
  for (const line of errors) {
    if (!line.startsWith('SKIP')) console.error(line);
  }
  console.error('Encrypt blocked: fix schema errors (npm run data:validate).');
  process.exit(1);
}
console.log('Schema validation passed.');

function encryptFile(rel) {
  const src = sourcePath(rel);
  const text = readFileIfExists(src);
  if (text === null) {
    console.warn(`[warn] No source file to encrypt: ${rel}`);
    return;
  }
  const dest = encryptedPath(rel);
  ensureDir(path.dirname(dest));
  const wrapper = encryptJson(text);
  fs.writeFileSync(dest, wrapper + '\n', 'utf8');
  console.log(`Encrypted: ${rel} → ${path.relative(ENCRYPTED_DIR, dest)}`);
}

if (!fs.existsSync(SOURCE_DIR)) {
  console.error('data/source/ not found. Run: npm run data:migrate-from-seed');
  process.exit(1);
}

ensureDir(ENCRYPTED_DIR);
const paths = allSourcePaths();
if (paths.length === 0) {
  console.error('No files in data/source/. Run migrate or decrypt first.');
  process.exit(1);
}

for (const rel of paths) {
  encryptFile(rel);
}

console.log(`Done. Encrypted ${paths.length} file(s).`);
