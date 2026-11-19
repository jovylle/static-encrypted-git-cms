// Bridge between plaintext source (data/source/**, gitignored) and committed ciphertext (data/encrypted/**).
// Used by scripts/data-encrypt.mjs (`npm run data:encrypt`, also `npm run data:save`).
//
// encryptSourceFile(rel, { force }) returns:
//   'missing-source'  no file under data/source/ for rel
//   'skipped'         existing .enc decrypts to the same text as the source (trailing newlines ignored)
//   'created'         no readable existing .enc (see WARNING below for what "no readable" includes)
//   'updated'         existing .enc decrypted to different text
// force=true rewrites the .enc even when it already matches.
//
// Caution: the .enc is also rewritten when the existing file cannot be read at all (wrong key, corrupt
// wrapper). Read the WARNING on readEncryptedPlaintext before changing that path.

import fs from 'fs';
import path from 'path';
import { decryptJson, encryptJson } from './content-crypto.mjs';
import { encryptedPath, sourcePath } from './data-paths.mjs';
import { ensureDir, readFileIfExists } from './data-io.mjs';

/** Normalize trailing newlines so decrypt/encrypt round-trips compare cleanly. */
export function normalizePlaintext(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\n+$/, '');
}

export function plaintextsMatch(sourceText, encryptedPlaintext) {
  if (sourceText == null || encryptedPlaintext == null) return false;
  return normalizePlaintext(sourceText) === normalizePlaintext(encryptedPlaintext);
}

// WARNING (known hazard, intentionally not fixed here):
// Returns null for ANY failure, not only a missing file: wrong CONTENT_DECRYPT_KEY, corrupt wrapper,
// unsupported version, or a file that is empty (readFileIfExists returns null). The caller cannot tell
// these apart.
// encryptSourceFile() then treats the committed .enc as absent, so it re-encrypts the current source
// with the current key and writes the .enc. Every source file that exists is rewritten, and the result
// is reported as 'created' (not 'updated'), because existingPlain is null in this case.
// Effect: running data:encrypt with the wrong key replaces committed ciphertext, and the old version
// survives only in git history. Confirm the key matches the committed ciphertext before running
// data:encrypt or data:save.
export function readEncryptedPlaintext(rel) {
  const dest = encryptedPath(rel);
  const wrapper = readFileIfExists(dest);
  if (wrapper === null) return null;
  try {
    return decryptJson(wrapper.trim());
  } catch {
    return null;
  }
}

/**
 * Encrypt one source file when plaintext differs from the existing .enc (or file is missing).
 * @returns {'created' | 'updated' | 'skipped' | 'missing-source'}
 */
export function encryptSourceFile(rel, { force = false } = {}) {
  const srcText = readFileIfExists(sourcePath(rel));
  if (srcText === null) {
    return 'missing-source';
  }

  const existingPlain = readEncryptedPlaintext(rel);
  if (!force && plaintextsMatch(srcText, existingPlain)) {
    return 'skipped';
  }

  const dest = encryptedPath(rel);
  ensureDir(path.dirname(dest));
  fs.writeFileSync(dest, `${encryptJson(srcText)}\n`, 'utf8');
  return existingPlain === null ? 'created' : 'updated';
}
