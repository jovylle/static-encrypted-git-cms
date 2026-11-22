// Decrypts data/encrypted/**/*.json.enc into data/source/ (gitignored plaintext).
// Fail closed: every file is attempted, each failure is reported, and the process exits 1 at the end
// unless ALLOW_PARTIAL_EXPORT=1 is set (decrypt-report.mjs). Files that failed keep their old plaintext
// (or none), and nothing is written for them.

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
import {
  isPartialAllowed,
  summarizeDecryptFailures,
} from './lib/decrypt-report.mjs';

loadDotEnv();

/** @returns {boolean} true when the file was written */
function decryptFile(encRel, failures) {
  const fullEnc = path.join(ENCRYPTED_DIR, encRel);
  const text = readFileIfExists(fullEnc);
  if (text === null) {
    console.warn(`[warn] No encrypted file: ${encRel}`);
    return false;
  }
  let plain;
  try {
    plain = decryptJson(text);
  } catch (e) {
    console.warn(`[warn] Failed to decrypt ${encRel}: ${e.message}`);
    failures.push({ file: encRel, message: e.message });
    return false;
  }
  const srcRel = encryptedToSourceRel(encRel);
  const dest = sourcePath(srcRel);
  ensureDir(path.dirname(dest));
  fs.writeFileSync(dest, plain.endsWith('\n') ? plain : plain + '\n', 'utf8');
  console.log(`Decrypted: ${encRel} → data/source/${srcRel}`);
  return true;
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

const failures = [];
let written = 0;
for (const encRel of encPaths) {
  if (decryptFile(encRel, failures)) written += 1;
}

const report = summarizeDecryptFailures(failures, {
  action: 'decrypt',
  allowPartial: isPartialAllowed(),
});
for (const line of report.lines) {
  if (report.exitCode === 0) console.warn(line);
  else console.error(line);
}
process.exitCode = report.exitCode;

console.log(`Done. Decrypted ${written} of ${encPaths.length} file(s).`);
