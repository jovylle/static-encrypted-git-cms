import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCollectionVisibilityUpdate,
  applyProjectVisibilityUpdate,
  normalizePublishControls,
} from '../packages/api/src/lib/visibility-mutators.ts';
import {
  shouldExportCollection,
  normalizePublishControls as normalizeExportControls,
} from '../scripts/lib/publish-controls.mjs';

test('applyProjectVisibilityUpdate updates matching slug', () => {
  const data = {
    projects: [{ slug: 'abc', status: 'published', private: false }],
  };
  const project = applyProjectVisibilityUpdate(data, {
    slug: 'abc',
    status: 'draft',
    private: true,
  });
  assert.equal(project.status, 'draft');
  assert.equal(project.private, true);
});

test('applyProjectVisibilityUpdate accepts private status', () => {
  const data = {
    projects: [{ slug: 'abc', status: 'published', private: false }],
  };
  const project = applyProjectVisibilityUpdate(data, {
    slug: 'abc',
    status: 'private',
  });
  assert.equal(project.status, 'private');
});

test('applyProjectVisibilityUpdate rejects invalid status', () => {
  const data = {
    projects: [{ slug: 'abc', status: 'published', private: false }],
  };
  assert.throws(
    () => applyProjectVisibilityUpdate(data, { slug: 'abc', status: 'hidden' }),
    /status must be/,
  );
});

const ALL_COLLECTIONS_PUBLIC = {
  'personal-projects': 'public',
  projects: 'public',
  highlights: 'public',
  profile: 'public',
  resume: 'public',
  blogs: 'public',
  notifications: 'public',
  homepage: 'public',
  social: 'public',
  uses: 'public',
};

test('collection controls normalization defaults to public', () => {
  assert.deepEqual(normalizePublishControls(null), {
    collections: ALL_COLLECTIONS_PUBLIC,
  });
  assert.deepEqual(normalizeExportControls({}), {
    collections: ALL_COLLECTIONS_PUBLIC,
  });
});

test('admin write-back keeps statuses for every exported collection', () => {
  const stored = {
    collections: { ...ALL_COLLECTIONS_PUBLIC, homepage: 'private', social: 'draft', uses: 'private' },
  };
  const controls = applyCollectionVisibilityUpdate(stored, {
    collection: 'projects',
    status: 'draft',
  });
  assert.equal(controls.collections.projects, 'draft');
  assert.equal(controls.collections.homepage, 'private');
  assert.equal(controls.collections.social, 'draft');
  assert.equal(controls.collections.uses, 'private');
  assert.deepEqual(Object.keys(controls.collections).sort(), Object.keys(ALL_COLLECTIONS_PUBLIC).sort());
});

test('collection-level visibility toggle controls export', () => {
  const controls = applyCollectionVisibilityUpdate(
    { collections: { 'personal-projects': 'public' } },
    { collection: 'personal-projects', status: 'draft' },
  );
  assert.equal(controls.collections['personal-projects'], 'draft');
  assert.equal(shouldExportCollection(controls, 'personal-projects'), false);
  assert.equal(shouldExportCollection(controls, 'projects'), true);
});
