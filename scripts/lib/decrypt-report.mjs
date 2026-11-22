// Fail-closed policy for scripts that decrypt data/encrypted/ (data-export.mjs, data-decrypt.mjs).
// Callers collect every failure during the run, then call summarizeDecryptFailures() once at the end.
// Any failure gives exitCode 1, unless ALLOW_PARTIAL_EXPORT=1 is set in the environment. That flag turns
// the failures into warnings so the run can continue with the files that did decrypt.

export const ALLOW_PARTIAL_ENV = 'ALLOW_PARTIAL_EXPORT';

export function isPartialAllowed(env = process.env) {
  return env[ALLOW_PARTIAL_ENV] === '1';
}

/**
 * @param {Array<{ file: string, message: string }>} failures
 * @param {{ action?: string, allowPartial?: boolean }} [options]
 * @returns {{ exitCode: number, lines: string[] }}
 */
export function summarizeDecryptFailures(failures, { action = 'export', allowPartial = false } = {}) {
  if (!failures || failures.length === 0) return { exitCode: 0, lines: [] };

  const lines = [`${failures.length} encrypted file(s) failed to decrypt or parse:`];
  for (const f of failures) {
    lines.push(`  - ${f.file}: ${f.message}`);
  }
  lines.push(
    'Most likely cause: CONTENT_DECRYPT_KEY is missing, wrong, or does not match the committed data/encrypted/ files (check .env).',
  );
  if (allowPartial) {
    lines.push(`${ALLOW_PARTIAL_ENV}=1 is set: continuing with the files that decrypted.`);
    return { exitCode: 0, lines };
  }
  lines.push(
    `${action === 'decrypt' ? 'Decrypt' : 'Export'} failed (exit 1). Set ${ALLOW_PARTIAL_ENV}=1 only if a partial result is acceptable.`,
  );
  return { exitCode: 1, lines };
}
