// AES-256-GCM encryption for data/encrypted/*.json.enc. Node-only (node:crypto).
//
// Inputs/outputs:
//   encryptJson(plaintextString) -> wrapper string {"v":1,"iv","tag","data"} (base64 fields, no trailing
//                                   newline; callers add "\n" when writing files).
//   decryptJson(wrapperText)     -> plaintext string. Throws on an unsupported version, a malformed wrapper,
//                                   or a wrong key.
//
// Invariants and gotchas:
// - Key = scrypt(CONTENT_DECRYPT_KEY, SCRYPT_SALT, 32). The salt is a constant, so one passphrase gives the
//   same key everywhere (local scripts, CI, and the Worker). The Worker has its own copy in
//   packages/api/src/lib/content-crypto.ts; keep the salt, algorithm, and wrapper format identical in both.
// - Each encryption uses a fresh random 12-byte IV. Never reuse an IV with the same key.
// - No key fingerprint, key ID, or rotation support. A wrong key is only detected at decrypt time, when GCM
//   auth fails on decipher.final(). Changing the key makes every committed .enc unreadable unless the
//   plaintext in data/source/ is still available to re-encrypt.
// - getContentKey() throws if the key is missing or shorter than 16 characters. It runs scrypt on every call;
//   nothing is cached here.
// - The version check (v must be 1) runs before any key work.

import crypto from 'crypto';

const SCRYPT_SALT = 'static-encrypted-cms-content-v1';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

export function getContentKey() {
  const raw = process.env.CONTENT_DECRYPT_KEY;
  if (!raw || raw.length < 16) {
    throw new Error(
      'CONTENT_DECRYPT_KEY must be set in .env (min 16 characters). See .env.example.',
    );
  }
  return crypto.scryptSync(raw, SCRYPT_SALT, 32);
}

export function encryptJson(plaintext) {
  const key = getContentKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    v: 1,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64'),
  });
}

export function decryptJson(wrapperText) {
  const wrapper = JSON.parse(wrapperText);
  if (wrapper.v !== 1) {
    throw new Error(`Unsupported encryption version: ${wrapper.v}`);
  }
  const key = getContentKey();
  const iv = Buffer.from(wrapper.iv, 'base64');
  const tag = Buffer.from(wrapper.tag, 'base64');
  const data = Buffer.from(wrapper.data, 'base64');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
}
