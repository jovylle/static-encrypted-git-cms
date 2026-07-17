import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getAuthenticatedIngestToken,
  isCollectionAllowedForToken,
} from '../netlify/functions/lib/admin-auth.mjs';

const ORIGINAL_INGEST_TOKENS = process.env.INGEST_TOKENS;

test.afterEach(() => {
  if (ORIGINAL_INGEST_TOKENS === undefined) {
    delete process.env.INGEST_TOKENS;
  } else {
    process.env.INGEST_TOKENS = ORIGINAL_INGEST_TOKENS;
  }
});

test('authenticates a valid token and reports its allowed collections', () => {
  process.env.INGEST_TOKENS = 'ci-blogs:s3cr3t-abc:blogs,ci-notify:s3cr3t-xyz:notifications|blogs';

  const token = getAuthenticatedIngestToken({ authorization: 'Bearer s3cr3t-abc' });
  assert.ok(token);
  assert.equal(token.tokenId, 'ci-blogs');
  assert.deepEqual(token.allowedCollections, ['blogs']);
  assert.ok(isCollectionAllowedForToken(token, 'blogs'));

  const multiCollectionToken = getAuthenticatedIngestToken({ authorization: 'Bearer s3cr3t-xyz' });
  assert.deepEqual(multiCollectionToken.allowedCollections, ['notifications', 'blogs']);
});

test('rejects a valid token for a collection it is not allowlisted for', () => {
  process.env.INGEST_TOKENS = 'ci-blogs:s3cr3t-abc:blogs';

  const token = getAuthenticatedIngestToken({ authorization: 'Bearer s3cr3t-abc' });
  assert.ok(token);
  assert.equal(isCollectionAllowedForToken(token, 'notifications'), false);
});

test('returns null for a malformed Authorization header', () => {
  process.env.INGEST_TOKENS = 'ci-blogs:s3cr3t-abc:blogs';

  assert.equal(getAuthenticatedIngestToken({ authorization: 's3cr3t-abc' }), null);
  assert.equal(getAuthenticatedIngestToken({ authorization: 'Bearer ' }), null);
  assert.equal(getAuthenticatedIngestToken({}), null);
});

test('returns null when the presented token does not match any configured token', () => {
  process.env.INGEST_TOKENS = 'ci-blogs:s3cr3t-abc:blogs';

  assert.equal(getAuthenticatedIngestToken({ authorization: 'Bearer nope' }), null);
});

test('ignores malformed INGEST_TOKENS entries', () => {
  process.env.INGEST_TOKENS = 'missing-collection:secret,ci-blogs:s3cr3t-abc:blogs';

  const token = getAuthenticatedIngestToken({ authorization: 'Bearer s3cr3t-abc' });
  assert.ok(token);
  assert.equal(token.tokenId, 'ci-blogs');
});

test('defaults writeMode to pr when the optional 4th field is omitted', () => {
  process.env.INGEST_TOKENS = 'ci-blogs:s3cr3t-abc:blogs';

  const token = getAuthenticatedIngestToken({ authorization: 'Bearer s3cr3t-abc' });
  assert.equal(token.writeMode, 'pr');
});

test('honors an explicit writeMode=commit in the optional 4th field', () => {
  process.env.INGEST_TOKENS = 'ci-fast-scores:s3cr3t-fast:fast-scores:commit';

  const token = getAuthenticatedIngestToken({ authorization: 'Bearer s3cr3t-fast' });
  assert.equal(token.writeMode, 'commit');
});

test('falls back to pr for an unrecognized writeMode value', () => {
  process.env.INGEST_TOKENS = 'ci-blogs:s3cr3t-abc:blogs:bogus-mode';

  const token = getAuthenticatedIngestToken({ authorization: 'Bearer s3cr3t-abc' });
  assert.equal(token.writeMode, 'pr');
});
