import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCollectionData } from '../scripts/lib/validate-data.mjs';

test('validateCollectionData rejects invalid projects payload', async () => {
  const result = await validateCollectionData('projects', {});
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((line) => line.startsWith('FAIL projects')));
});

test('validateCollectionData accepts minimal valid publish-controls', async () => {
  const result = await validateCollectionData('publish-controls', {
    collections: {
      'personal-projects': 'public',
      projects: 'public',
      highlights: 'public',
      profile: 'public',
      resume: 'public',
      blogs: 'public',
      notifications: 'public',
    },
  });
  assert.equal(result.ok, true);
});

test('validateCollectionData skips unknown collection ids', async () => {
  const result = await validateCollectionData('not-a-collection', { foo: 'bar' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});
