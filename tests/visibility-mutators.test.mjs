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
  assert.deepEqual(normalizePublishControls(null), { personal_projects_public: true });
  assert.deepEqual(normalizeExportControls({}), { personal_projects_public: true });
});

test('collection-level visibility toggle controls export', () => {
  const controls = applyCollectionVisibilityUpdate(
    { personal_projects_public: true },
    { personal_projects_public: false },
  );
  assert.equal(controls.personal_projects_public, false);
  assert.equal(shouldExportCollection(controls, 'personal-projects'), false);
  assert.equal(shouldExportCollection(controls, 'projects'), true);
});
