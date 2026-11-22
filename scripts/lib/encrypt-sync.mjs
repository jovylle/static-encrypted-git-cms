// Bridge between plaintext source (data/source/**, gitignored) and committed ciphertext (data/encrypted/**).
// Used by scripts/data-encrypt.mjs (`npm run data:encrypt`, also `npm run data:save`).
//
// encryptSourceFile(rel, { force }) returns:
//   'missing-source'  no file under data/source/ for rel
//   'skipped'         existing .enc decrypts to the same text as the source (trailing newlines ignored)
//   'created'         no .enc existed for rel; a new one was written
//   'updated'         existing .enc decrypted to different text, or force=true overwrote it
// It THROWS ExistingCiphertextError when an existing .enc cannot be decrypted (wrong key, corrupt wrapper,
// empty file), unless force=true. A missing .enc is a normal create and never throws.
//
// Fail closed: an unreadable .enc is never silently replaced. Replacing it needs an explicit --force, and
// the committed ciphertext is then overwritten (the old version survives only in git history).
// Use findUnreadableCiphertext() to check every file before writing any (data-encrypt.mjs does this).

import fs from 'fs';
import path from 'path';
import { decryptJson, encryptJson } from './content-crypto.mjs';
import { ENCRYPTED_DIR, SOURCE_DIR, encryptedPath, sourcePath } from './data-paths.mjs';
import { ensureDir, readFileIfExists } from './data-io.mjs';

/** Normalize trailing newlines so decrypt/encrypt round-trips compare cleanly. */
export function normalizePlaintext(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\n+$/, '');
}

export function plaintextsMatch(sourceText, encryptedPlaintext) {
  if (sourceText == null || encryptedPlaintext == null) return false;
  return normalizePlaintext(sourceText) === normalizePlaintext(encryptedPlaintext);
}

export class ExistingCiphertextError extends Error {
  constructor(rel, cause) {
    super(
      `Existing ${rel} cannot be decrypted (${cause}). It was NOT overwritten. ` +
        'Check that CONTENT_DECRYPT_KEY matches the committed vault. ' +
        'Re-run with --force only if you intend to replace the committed ciphertext.',
    );
    this.name = 'ExistingCiphertextError';
    this.rel = rel;
    this.reason = String(cause);
  }
}

/**
 * @returns {string | null} plaintext of the existing .enc, or null when no .enc exists.
 * @throws {ExistingCiphertextError} when the .enc exists but cannot be read or decrypted (including empty).
 */
export function readEncryptedPlaintext(rel, { encryptedDir = ENCRYPTED_DIR } = {}) {
  const dest = encryptedPath(rel, encryptedDir);
  if (!fs.existsSync(dest)) return null;
  let wrapper;
  try {
    wrapper = fs.readFileSync(dest, 'utf8').trim();
    return decryptJson(wrapper);
  } catch (e) {
    throw new ExistingCiphertextError(rel, e.message);
  }
}

/**
 * Read-only check for data:encrypt. Lists every existing .enc (for the given rels) that cannot be decrypted.
 * @returns {Array<{ rel: string, reason: string }>}
 */
export function findUnreadableCiphertext(rels, { encryptedDir = ENCRYPTED_DIR } = {}) {
  const unreadable = [];
  for (const rel of rels) {
    try {
      readEncryptedPlaintext(rel, { encryptedDir });
    } catch (e) {
      unreadable.push({ rel, reason: e.reason ?? e.message });
    }
  }
  return unreadable;
}

/**
 * Encrypt one source file when plaintext differs from the existing .enc (or no .enc exists).
 * @param {string} rel
 * @param {{ force?: boolean, sourceDir?: string, encryptedDir?: string }} [options]
 * @returns {'created' | 'updated' | 'skipped' | 'missing-source'}
 * @throws {ExistingCiphertextError} when an existing .enc cannot be decrypted and force is false.
 */
export function encryptSourceFile(
  rel,
  { force = false, sourceDir = SOURCE_DIR, encryptedDir = ENCRYPTED_DIR } = {},
) {
  const srcText = readFileIfExists(sourcePath(rel, sourceDir));
  if (srcText === null) {
    return 'missing-source';
  }

  const dest = encryptedPath(rel, encryptedDir);
  const existed = fs.existsSync(dest);

  let existingPlain = null;
  try {
    existingPlain = readEncryptedPlaintext(rel, { encryptedDir });
  } catch (e) {
    if (!force) throw e;
    // --force: the caller accepted replacing a ciphertext this key cannot read.
  }

  if (!force && plaintextsMatch(srcText, existingPlain)) {
    return 'skipped';
  }

  ensureDir(path.dirname(dest));
  fs.writeFileSync(dest, `${encryptJson(srcText)}\n`, 'utf8');
  return existed ? 'updated' : 'created';
}
