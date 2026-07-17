import {
  readEncryptedJsonFile as defaultReadEncryptedJsonFile,
  writeEncryptedJsonFile as defaultWriteEncryptedJsonFile,
} from './encrypted-content-store.mjs';

const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Read the current encrypted JSON file, apply `mergeFn` to produce the next
 * document, validate it against the collection schema, and write it back
 * using the sha read in this same attempt. If GitHub reports a 409 (the sha
 * went stale because someone else wrote in between), the whole read-merge-
 * validate-write cycle is retried against the latest content.
 *
 * @param {object} params
 * @param {string} params.collectionKey - manifest collection id used for schema validation.
 * @param {string} params.filePath - encrypted file path in the repo.
 * @param {*} [params.defaultValue] - value to use when the file doesn't exist yet.
 * @param {(currentData: *) => (* | Promise<*>)} params.mergeFn - produces the next document from the current one.
 * @param {string} params.actor
 * @param {string} params.branchHint
 * @param {string} params.message
 * @param {string} [params.writeMode] - forwarded to writeFile (e.g. 'pr' to force a PR write regardless of ADMIN_GITHUB_WRITE_MODE).
 * @param {number} [params.maxAttempts]
 * @param {typeof defaultReadEncryptedJsonFile} [params.readFile]
 * @param {typeof defaultWriteEncryptedJsonFile} [params.writeFile]
 */
export async function readMergeWriteWithRetry({
  collectionKey,
  filePath,
  defaultValue = null,
  mergeFn,
  actor,
  branchHint,
  message,
  writeMode,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  readFile = defaultReadEncryptedJsonFile,
  writeFile = defaultWriteEncryptedJsonFile,
}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const { data: currentData, sha } = await readFile(filePath, defaultValue);
    const merged = await mergeFn(currentData);

    const { validateCollectionData } = await import('./validate-collection.mjs');
    const validation = await validateCollectionData(collectionKey, merged);
    if (!validation.ok) {
      const error = new Error('Validation failed');
      error.validationErrors = validation.errors;
      throw error;
    }

    try {
      const write = await writeFile({
        filePath,
        data: merged,
        sha,
        actor,
        branchHint,
        message,
        writeMode,
      });
      return { data: merged, write };
    } catch (e) {
      if (e.status !== 409) throw e;
      if (attempt === maxAttempts) {
        throw new Error(
          `Write conflict on ${filePath} after ${maxAttempts} attempts; please retry.`,
        );
      }
    }
  }

  throw new Error(`Write conflict on ${filePath}; please retry.`);
}
