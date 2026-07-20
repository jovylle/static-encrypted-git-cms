import crypto from 'node:crypto';

const SCRYPT_SALT = 'static-encrypted-cms-content-v1';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

export function getContentKey(env: { CONTENT_DECRYPT_KEY?: string }): Buffer {
  const raw = env.CONTENT_DECRYPT_KEY || '';
  if (!raw || raw.length < 16) {
    throw new Error(
      'CONTENT_DECRYPT_KEY must be set (min 16 characters).',
    );
  }
  return crypto.scryptSync(raw, SCRYPT_SALT, 32);
}

export function encryptJson(plaintext: string, env: { CONTENT_DECRYPT_KEY?: string }): string {
  const key = getContentKey(env);
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

export function decryptJson(wrapperText: string, env: { CONTENT_DECRYPT_KEY?: string }): string {
  const wrapper = JSON.parse(wrapperText);
  if (wrapper.v !== 1) {
    throw new Error(`Unsupported encryption version: ${wrapper.v}`);
  }
  const key = getContentKey(env);
  const iv = Buffer.from(wrapper.iv, 'base64');
  const tag = Buffer.from(wrapper.tag, 'base64');
  const data = Buffer.from(wrapper.data, 'base64');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
}
