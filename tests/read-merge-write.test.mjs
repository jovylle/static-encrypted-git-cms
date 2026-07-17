import test from 'node:test';
import assert from 'node:assert/strict';
import { readMergeWriteWithRetry } from '../netlify/functions/lib/read-merge-write.mjs';

function conflictError() {
  const err = new Error('GitHub API 409: sha mismatch');
  err.status = 409;
  return err;
}

test('retries the full read-merge-write cycle on a 409 conflict', async () => {
  let readCalls = 0;
  let writeCalls = 0;
  const shaPerRead = ['sha-stale', 'sha-fresh'];

  const readFile = async () => {
    const sha = shaPerRead[readCalls];
    readCalls += 1;
    return { data: { count: readCalls }, sha, exists: true };
  };

  const writeFile = async ({ sha }) => {
    writeCalls += 1;
    if (sha === 'sha-stale') throw conflictError();
    return { commitSha: 'abc123', sha };
  };

  const result = await readMergeWriteWithRetry({
    collectionKey: 'not-a-real-collection',
    filePath: 'data/encrypted/fake.json.enc',
    mergeFn: (current) => ({ ...current, merged: true }),
    actor: 'tester',
    branchHint: 'test',
    message: 'test write',
    readFile,
    writeFile,
  });

  assert.equal(readCalls, 2);
  assert.equal(writeCalls, 2);
  assert.equal(result.write.commitSha, 'abc123');
  assert.deepEqual(result.data, { count: 2, merged: true });
});

test('does not retry and propagates a non-409 error immediately', async () => {
  let readCalls = 0;
  let writeCalls = 0;

  const readFile = async () => {
    readCalls += 1;
    return { data: { count: readCalls }, sha: 'sha-1', exists: true };
  };

  const writeFile = async () => {
    writeCalls += 1;
    const err = new Error('GitHub API 500: internal error');
    err.status = 500;
    throw err;
  };

  await assert.rejects(
    () =>
      readMergeWriteWithRetry({
        collectionKey: 'not-a-real-collection',
        filePath: 'data/encrypted/fake.json.enc',
        mergeFn: (current) => current,
        actor: 'tester',
        branchHint: 'test',
        message: 'test write',
        readFile,
        writeFile,
      }),
    /500/,
  );

  assert.equal(readCalls, 1);
  assert.equal(writeCalls, 1);
});

test('throws a clear error after exhausting retries on repeated 409s', async () => {
  const readFile = async () => ({ data: {}, sha: 'sha-stale', exists: true });
  const writeFile = async () => {
    throw conflictError();
  };

  await assert.rejects(
    () =>
      readMergeWriteWithRetry({
        collectionKey: 'not-a-real-collection',
        filePath: 'data/encrypted/fake.json.enc',
        mergeFn: (current) => current,
        actor: 'tester',
        branchHint: 'test',
        message: 'test write',
        maxAttempts: 2,
        readFile,
        writeFile,
      }),
    /conflict/i,
  );
});
