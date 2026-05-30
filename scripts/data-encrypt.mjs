import fs from 'fs';
import path from 'path';
import {
  SOURCE_DIR,
  ENCRYPTED_DIR,
  allSourcePaths,
  encryptedPath,
} from './lib/data-paths.mjs';
import { loadDotEnv } from './lib/data-io.mjs';
import { encryptSourceFile } from './lib/encrypt-sync.mjs';
import { validateSourceData } from './lib/validate-data.mjs';

loadDotEnv();

const force = process.argv.includes('--force');

const { ok, errors } = await validateSourceData();
if (!ok) {
  for (const line of errors) {
    if (!line.startsWith('SKIP')) console.error(line);
  }
  console.error('Encrypt blocked: fix schema errors (npm run data:validate).');
  process.exit(1);
}
console.log('Schema validation passed.');

if (!fs.existsSync(SOURCE_DIR)) {
  console.error('data/source/ not found. Run: npm run data:migrate-from-seed');
  process.exit(1);
}

const paths = allSourcePaths();
if (paths.length === 0) {
  console.error('No files in data/source/. Run migrate or decrypt first.');
  process.exit(1);
}

const counts = { created: 0, updated: 0, skipped: 0, missing: 0 };

for (const rel of paths) {
  const result = encryptSourceFile(rel, { force });
  counts[result === 'missing-source' ? 'missing' : result] += 1;

  const encName = path.relative(ENCRYPTED_DIR, encryptedPath(rel));
  if (result === 'skipped') {
    console.log(`Skipped (unchanged): ${rel} → ${encName}`);
  } else if (result === 'missing-source') {
    console.warn(`[warn] No source file to encrypt: ${rel}`);
  } else {
    console.log(`Encrypted: ${rel} → ${encName}`);
  }
}

const touched = counts.created + counts.updated;
console.log(
  `Done. ${touched} encrypted, ${counts.skipped} unchanged${force ? ' (--force)' : ''}.`,
);
