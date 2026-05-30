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
