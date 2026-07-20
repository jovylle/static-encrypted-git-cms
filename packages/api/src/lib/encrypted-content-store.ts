import { decryptJson, encryptJson } from './content-crypto';
import { getGithubConfig, getRepoTextFile, writeRepoTextFile } from './github-content';

export async function readEncryptedJsonFile(
  env: {
    CONTENT_DECRYPT_KEY?: string;
    GITHUB_TOKEN?: string;
    GITHUB_REPO?: string;
    GITHUB_BRANCH?: string;
    ADMIN_GITHUB_WRITE_MODE?: string;
  },
  filePath: string,
  defaultValue: any = null,
): Promise<{ data: any; sha: string | null; exists: boolean }> {
  const config = getGithubConfig(env);
  const file = await getRepoTextFile(config, filePath);
  if (!file.exists) {
    if (defaultValue !== null) return { data: defaultValue, sha: null, exists: false };
    throw new Error(`Encrypted file not found: ${filePath}`);
  }

  const plainText = decryptJson(file.text!, env);
  let data: any;
  try {
    data = JSON.parse(plainText);
  } catch (e: any) {
    throw new Error(`Invalid decrypted JSON in ${filePath}: ${e.message}`);
  }
  return { data, sha: file.sha!, exists: true };
}

export async function writeEncryptedJsonFile(
  env: {
    CONTENT_DECRYPT_KEY?: string;
    GITHUB_TOKEN?: string;
    GITHUB_REPO?: string;
    GITHUB_BRANCH?: string;
    ADMIN_GITHUB_WRITE_MODE?: string;
  },
  params: {
    filePath: string;
    data: any;
    sha: string | null;
    message: string;
    actor: string;
    branchHint: string;
  },
): Promise<{
  commitSha: string | null;
  commitUrl: string | null;
  branch: string;
  pullRequest: { number: number; url: string } | null;
}> {
  const config = getGithubConfig(env);
  const plaintext = JSON.stringify(params.data, null, 2);
  const encryptedWrapper = `${encryptJson(plaintext, env)}\n`;
  return writeRepoTextFile(config, {
    filePath: params.filePath,
    content: encryptedWrapper,
    message: params.message,
    actor: params.actor,
    branchHint: params.branchHint,
    previousSha: params.sha || undefined,
  });
}
