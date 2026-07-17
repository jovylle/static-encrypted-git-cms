import { decryptJson, encryptJson } from '../../../scripts/lib/content-crypto.mjs';
import { getRepoTextFile, writeRepoTextFile } from './github-content.mjs';

export async function readEncryptedJsonFile(filePath, defaultValue = null) {
  const file = await getRepoTextFile(filePath);
  if (!file.exists) {
    if (defaultValue !== null) return { data: defaultValue, sha: null, exists: false };
    throw new Error(`Encrypted file not found: ${filePath}`);
  }

  const plainText = decryptJson(file.text);
  let data;
  try {
    data = JSON.parse(plainText);
  } catch (e) {
    throw new Error(`Invalid decrypted JSON in ${filePath}: ${e.message}`);
  }
  return { data, sha: file.sha, exists: true };
}

export async function writeEncryptedJsonFile({
  filePath,
  data,
  sha,
  message,
  actor,
  branchHint,
  writeMode,
}) {
  const plaintext = JSON.stringify(data, null, 2);
  const encryptedWrapper = `${encryptJson(plaintext)}\n`;
  return writeRepoTextFile({
    filePath,
    content: encryptedWrapper,
    message,
    actor,
    branchHint,
    previousSha: sha || undefined,
    writeMode,
  });
}
