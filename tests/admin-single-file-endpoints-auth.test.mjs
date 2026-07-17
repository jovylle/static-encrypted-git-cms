import test from 'node:test';
import assert from 'node:assert/strict';
import { handler as blogFileHandler } from '../netlify/functions/admin-blog-file.mjs';
import { handler as notificationFileHandler } from '../netlify/functions/admin-notification-file.mjs';

const ORIGINAL_INGEST_TOKENS = process.env.INGEST_TOKENS;

test.afterEach(() => {
  if (ORIGINAL_INGEST_TOKENS === undefined) {
    delete process.env.INGEST_TOKENS;
  } else {
    process.env.INGEST_TOKENS = ORIGINAL_INGEST_TOKENS;
  }
});

test('admin-blog-file rejects a token scoped only to notifications with 403', async () => {
  process.env.INGEST_TOKENS = 'ci-notify:s3cr3t-xyz:notifications';

  const res = await blogFileHandler({
    httpMethod: 'GET',
    headers: { authorization: 'Bearer s3cr3t-xyz' },
    queryStringParameters: { slug: 'hello-world' },
  });

  assert.equal(res.statusCode, 403);
  const body = JSON.parse(res.body);
  assert.match(body.error, /blogs/);
});

test('admin-notification-file rejects a token scoped only to blogs with 403', async () => {
  process.env.INGEST_TOKENS = 'ci-blogs:s3cr3t-abc:blogs';

  const res = await notificationFileHandler({
    httpMethod: 'GET',
    headers: { authorization: 'Bearer s3cr3t-abc' },
    queryStringParameters: { slug: 'pinned' },
  });

  assert.equal(res.statusCode, 403);
  const body = JSON.parse(res.body);
  assert.match(body.error, /notifications/);
});

test('admin-blog-file falls through to 401 when no session cookie or token is present', async () => {
  process.env.INGEST_TOKENS = 'ci-blogs:s3cr3t-abc:blogs';

  const res = await blogFileHandler({
    httpMethod: 'GET',
    headers: {},
    queryStringParameters: { slug: 'hello-world' },
  });

  assert.equal(res.statusCode, 401);
});

test('admin-notification-file falls through to 401 for a malformed bearer token', async () => {
  process.env.INGEST_TOKENS = 'ci-notify:s3cr3t-xyz:notifications';

  const res = await notificationFileHandler({
    httpMethod: 'GET',
    headers: { authorization: 'Bearer wrong-secret' },
    queryStringParameters: { slug: 'pinned' },
  });

  assert.equal(res.statusCode, 401);
});
