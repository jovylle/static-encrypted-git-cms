const DEFAULT_MAX_ATTEMPTS = 3;

/** Shape returned by a read implementation for the current stored document. */
export interface ReadResult<T> {
  data: T;
  sha: string | null;
  exists?: boolean;
}

/** Produces the next document from the current one. May be async. */
export type MergeFn<T> = (currentData: T) => T | Promise<T>;

/** Arguments handed to a write implementation for a single write attempt. */
export interface WriteArgs<T> {
  filePath: string;
  data: T;
  sha: string | null;
  actor?: string;
  branchHint?: string;
  message?: string;
  writeMode?: string;
}

export type ReadFileFn<T> = (
  filePath: string,
  defaultValue?: T | null,
) => Promise<ReadResult<T>>;

export type WriteFileFn<T, W> = (args: WriteArgs<T>) => Promise<W>;

export interface ReadMergeWriteParams<T, W> {
  /** Manifest collection id used for schema validation. */
  collectionKey: string;
  /** Encrypted file path in the repo. */
  filePath: string;
  /** Value to use when the file doesn't exist yet. */
  defaultValue?: T | null;
  /** Produces the next document from the current one. */
  mergeFn: MergeFn<T>;
  actor?: string;
  branchHint?: string;
  message?: string;
  /** Forwarded to writeFile (e.g. 'pr' to force a PR write). */
  writeMode?: string;
  maxAttempts?: number;
  /** Reads the current file + sha. Injected so callers own storage access. */
  readFile: ReadFileFn<T>;
  /** Writes the merged document. Should reject with `.status === 409` on a stale sha. */
  writeFile: WriteFileFn<T, W>;
}

export interface ReadMergeWriteResult<T, W> {
  data: T;
  write: W;
}

/** Thrown when the merged document fails schema validation. */
export class ValidationError extends Error {
  validationErrors: string[];

  constructor(errors: string[]) {
    super('Validation failed');
    this.name = 'ValidationError';
    this.validationErrors = errors;
  }
}

function getErrorStatus(error: unknown): number | undefined {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status?: unknown }).status;
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}

/**
 * Read the current encrypted JSON file, apply `mergeFn` to produce the next
 * document, validate it against the collection schema, and write it back
 * using the sha read in this same attempt. If the write reports a 409 (the sha
 * went stale because someone else wrote in between), the whole read-merge-
 * validate-write cycle is retried against the latest content, up to
 * `maxAttempts` times.
 *
 * Storage access is fully injected via `readFile`/`writeFile` so the same
 * retry-safe contract can be reused across different backends (GitHub Contents
 * API, local filesystem, test doubles, etc.).
 */
export async function readMergeWriteWithRetry<T = unknown, W = unknown>(
  params: ReadMergeWriteParams<T, W>,
): Promise<ReadMergeWriteResult<T, W>> {
  const {
    collectionKey,
    filePath,
    defaultValue = null,
    mergeFn,
    actor,
    branchHint,
    message,
    writeMode,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    readFile,
    writeFile,
  } = params;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const { data: currentData, sha } = await readFile(filePath, defaultValue);
    const merged = await mergeFn(currentData);

    const { validateCollectionData } = await import('./validate-collection.ts');
    const validation = await validateCollectionData(collectionKey, merged);
    if (!validation.ok) {
      throw new ValidationError(validation.errors);
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
    } catch (error) {
      if (getErrorStatus(error) !== 409) throw error;
      if (attempt === maxAttempts) {
        throw new Error(
          `Write conflict on ${filePath} after ${maxAttempts} attempts; please retry.`,
        );
      }
    }
  }

  throw new Error(`Write conflict on ${filePath}; please retry.`);
}
