import fs from 'fs';
import path from 'path';
import {
  SOURCE_DIR,
  ENCRYPTED_DIR,
  allSourcePaths,
  encryptedPath,
} from './lib/data-paths.mjs';
import { loadDotEnv } from './lib/data-io.mjs';
import { checkEncryptPreflight, encryptSourceFile } from './lib/encrypt-sync.mjs';
import { validateSourceData } from './lib/validate-data.mjs';

loadDotEnv();

const force = process.argv.includes('--force');

const { ok, errors } = await validateSourceData();
if (!ok) {
  for (const line of errors) {
    if (!line.startsWith('SKIP')) console.error(line);
  }
  console.error('Encrypt blocked: validation failed (npm run data:validate).');
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

// Fail closed before writing anything: an existing .enc this key cannot read means a wrong key (or a
// corrupt file). Writing would silently replace committed ciphertext. --force overrides this on purpose.
const unreadable = checkEncryptPreflight(paths, { force });
if (unreadable.length > 0) {
  console.error(
    `Encrypt blocked: ${unreadable.length} committed .enc file(s) cannot be decrypted with CONTENT_DECRYPT_KEY. Nothing was written.`,
  );
  for (const u of unreadable) {
    console.error(`  - ${u.rel}: ${u.reason}`);
  }
  console.error(
    'Check that CONTENT_DECRYPT_KEY in .env matches the vault. Use --force only if you intend to replace the committed ciphertext.',
  );
  process.exit(1);
}

const counts = { created: 0, updated: 0, skipped: 0, missing: 0 };

for (const rel of paths) {
  let result;
  try {
    result = encryptSourceFile(rel, { force });
  } catch (e) {
    console.error(`Encrypt blocked at ${rel}: ${e.message}`);
    process.exit(1);
  }
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
