import fs from 'fs';
import path from 'path';
import { decryptJson } from './lib/content-crypto.mjs';
import {
  ENCRYPTED_DIR,
  SOURCE_DIR,
  allEncryptedPaths,
  encryptedToSourceRel,
  sourcePath,
} from './lib/data-paths.mjs';
import { loadDotEnv, ensureDir, readFileIfExists } from './lib/data-io.mjs';

loadDotEnv();

function decryptFile(encRel) {
  const fullEnc = path.join(ENCRYPTED_DIR, encRel);
  const text = readFileIfExists(fullEnc);
  if (text === null) {
    console.warn(`[warn] No encrypted file: ${encRel}`);
    return;
  }
  const plain = decryptJson(text);
  const srcRel = encryptedToSourceRel(encRel);
  const dest = sourcePath(srcRel);
  ensureDir(path.dirname(dest));
  fs.writeFileSync(dest, plain.endsWith('\n') ? plain : plain + '\n', 'utf8');
  console.log(`Decrypted: ${encRel} → data/source/${srcRel}`);
}

if (!fs.existsSync(ENCRYPTED_DIR)) {
  console.error('data/encrypted/ not found. Run: npm run data:encrypt');
  process.exit(1);
}

ensureDir(SOURCE_DIR);
const encPaths = allEncryptedPaths();
if (encPaths.length === 0) {
  console.error('No .json.enc files in data/encrypted/.');
  process.exit(1);
}

for (const encRel of encPaths) {
  decryptFile(encRel);
}

console.log(`Done. Decrypted ${encPaths.length} file(s).`);
