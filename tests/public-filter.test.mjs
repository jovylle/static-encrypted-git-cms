import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublicBlogPost } from '../scripts/lib/public-filter.mjs';

test('isPublicBlogPost hides a post with top-level draft: true (matches the Worker top-level draft rule)', () => {
  assert.equal(
    isPublicBlogPost({ title: 'Draft', draft: true, status: 'published', body: '' }),
    false,
  );
});

test('isPublicBlogPost still hides frontmatter draft: true in the body', () => {
  const post = { title: 'Legacy', body: '---\ndraft: true\n---\nText' };
  assert.equal(isPublicBlogPost(post), false);
});

test('isPublicBlogPost keeps a normal published post', () => {
  assert.equal(
    isPublicBlogPost({ title: 'Live', draft: false, status: 'published', body: '' }),
    true,
  );
  assert.equal(isPublicBlogPost({ title: 'Plain', body: '' }), true);
});

test('isPublicBlogPost hides draft and private statuses', () => {
  assert.equal(isPublicBlogPost({ status: 'draft', body: '' }), false);
  assert.equal(isPublicBlogPost({ status: 'private', body: '' }), false);
  assert.equal(isPublicBlogPost({ private: true, body: '' }), false);
});
