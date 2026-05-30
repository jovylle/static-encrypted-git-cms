import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCollectionVisibilityUpdate,
  applyProjectVisibilityUpdate,
  normalizePublishControls,
} from '../netlify/functions/lib/visibility-mutators.mjs';
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

test('collection controls normalization defaults to public', () => {
  assert.deepEqual(normalizePublishControls(null), {
    collections: {
      'personal-projects': 'public',
      projects: 'public',
      highlights: 'public',
      profile: 'public',
      resume: 'public',
      blogs: 'public',
    },
  });
  assert.deepEqual(normalizeExportControls({}), {
    collections: {
      'personal-projects': 'public',
      projects: 'public',
      highlights: 'public',
      profile: 'public',
      resume: 'public',
      blogs: 'public',
    },
  });
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
