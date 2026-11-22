// Strict publish-controls gate. Runs the real export core against temp directories and a throwaway key.
// Never touches data/encrypted/, data/source/ or public/.
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { encryptJson } from '../scripts/lib/content-crypto.mjs';
import { CONTROLS_UNAVAILABLE_WARNING, exportPublicData } from '../scripts/lib/export-public.mjs';
import { loadPublishControls } from '../scripts/lib/export-gate.mjs';
import {
  normalizePublishControls,
  shouldExportCollection,
} from '../scripts/lib/publish-controls.mjs';

const KEY = 'throwaway-strict-controls-key-CCCCCCCC';

const ALL_PUBLIC = {
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

let savedKey;
let root;
let encryptedDir;
let publicDataDir;
let publicNotificationsDir;

function writeEnc(rel, obj) {
  const full = path.join(encryptedDir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, `${encryptJson(JSON.stringify(obj))}\n`, 'utf8');
}

/** Writes publish-controls.json.enc with the given raw object (no normalization, so bad shapes are possible). */
function writeControlsRaw(obj) {
  writeEnc('publish-controls.json.enc', obj);
}

/** A vault with one private-by-default-in-the-test collection (projects) and one public collection (highlights). */
function seedVault() {
  writeEnc('projects.json.enc', {
    projects: [{ slug: 'secret', title: 'Secret', status: 'published', private: false }],
  });
  writeEnc('highlights.json.enc', { items: [{ title: 'Highlight' }] });
  writeEnc('personal-projects.json.enc', {
    projects: [{ slug: 'pp', title: 'PP', status: 'published', private: false }],
  });
}

function run(opts = {}) {
  return exportPublicData({ encryptedDir, publicDataDir, publicNotificationsDir, ...opts });
}

function exists(...parts) {
  return fs.existsSync(path.join(publicDataDir, ...parts));
}

beforeEach(() => {
  savedKey = process.env.CONTENT_DECRYPT_KEY;
  process.env.CONTENT_DECRYPT_KEY = KEY;
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-controls-strict-'));
  encryptedDir = path.join(root, 'encrypted');
  publicDataDir = path.join(root, 'public', 'data');
  publicNotificationsDir = path.join(root, 'public', 'notifications');
  fs.mkdirSync(encryptedDir, { recursive: true });
  fs.mkdirSync(publicDataDir, { recursive: true });
  fs.mkdirSync(publicNotificationsDir, { recursive: true });
  seedVault();
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.CONTENT_DECRYPT_KEY;
  else process.env.CONTENT_DECRYPT_KEY = savedKey;
  fs.rmSync(root, { recursive: true, force: true });
});

const INVALID = [
  ['empty object', {}],
  ['collections is empty', { collections: {} }],
  ['collections is a string', { collections: 'all-private' }],
  ['one bad status value', { collections: { ...ALL_PUBLIC, resume: 'Private' } }],
];

for (const [label, controls] of INVALID) {
  test(`strict gate rejects controls (${label}) and fails closed`, () => {
    writeControlsRaw(controls);

    const { controls: loaded, failure } = loadPublishControls({ encryptedDir });
    assert.equal(loaded, null);
    assert.ok(failure, 'schema-invalid controls must be a failure');
    assert.equal(failure.file, 'publish-controls.json.enc');
    assert.doesNotMatch(failure.message, /Private/, 'the message must not echo a wrong value');

    const result = run();
    assert.equal(result.exitCode, 1);
    assert.equal(exists('projects.json'), false, 'a gated collection must not be exported');
    assert.equal(exists('highlights.json'), false, 'nothing gated is exported, even public-looking collections');
    assert.equal(exists('personal-projects.json'), false);
  });
}

test('strict gate names the wrong key in the failure message', () => {
  writeControlsRaw({ collections: { ...ALL_PUBLIC, resume: 'Private' } });
  const { failure } = loadPublishControls({ encryptedDir });
  assert.match(failure.message, /\/collections\/resume/);

  writeControlsRaw({ collections: {} });
  assert.match(loadPublishControls({ encryptedDir }).failure.message, /missing required key "projects"/);
});

test('a valid controls file passes and exports public collections', () => {
  writeControlsRaw({ collections: { ...ALL_PUBLIC, projects: 'private' } });

  const { controls, failure } = loadPublishControls({ encryptedDir });
  assert.equal(failure, null);
  assert.equal(shouldExportCollection(controls, 'projects'), false);
  assert.equal(shouldExportCollection(controls, 'highlights'), true);

  const result = run();
  assert.equal(result.exitCode, 0, result.lines.join('\n'));
  assert.equal(exists('projects.json'), false);
  assert.equal(exists('highlights.json'), true);
  assert.equal(exists('personal-projects.json'), true);
});

test('legacy personal_projects_public false wins over collections public (most restrictive)', () => {
  writeControlsRaw({ personal_projects_public: false, collections: { ...ALL_PUBLIC } });

  const { controls, failure } = loadPublishControls({ encryptedDir });
  assert.equal(failure, null, 'the legacy key is accepted by the strict schema');
  assert.equal(controls.collections['personal-projects'], 'private');
  assert.equal(shouldExportCollection(controls, 'personal-projects'), false);

  const result = run();
  assert.equal(result.exitCode, 0, result.lines.join('\n'));
  assert.equal(exists('personal-projects.json'), false, 'personal-projects must not be exported');
  assert.equal(exists('highlights.json'), true);
});

test('legacy personal_projects_public true does not override a more restrictive collections status', () => {
  const controls = normalizePublishControls({
    personal_projects_public: true,
    collections: { ...ALL_PUBLIC, 'personal-projects': 'draft' },
  });
  assert.equal(controls.collections['personal-projects'], 'draft');
  assert.equal(shouldExportCollection(controls, 'personal-projects'), false);
});

test('legacy boolean with a valid collections status: the more restrictive one applies', () => {
  assert.equal(
    normalizePublishControls({ personal_projects_public: true, collections: { 'personal-projects': 'public' } })
      .collections['personal-projects'],
    'public',
  );
  assert.equal(
    normalizePublishControls({ personal_projects_public: false, collections: { 'personal-projects': 'draft' } })
      .collections['personal-projects'],
    'private',
  );
});

test('partial mode: a schema-invalid controls file behaves like a missing one (warning, nothing gated, exit 0)', () => {
  writeControlsRaw({ collections: 'all-private' });
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  let result;
  try {
    result = run({ allowPartial: true });
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(result.exitCode, 0);
  assert.ok(result.lines.includes(CONTROLS_UNAVAILABLE_WARNING), 'loud warning in the report');
  assert.equal(exists('projects.json'), false);
  assert.equal(exists('highlights.json'), false, 'nothing gated is exported, not even highlights');
  assert.equal(exists('personal-projects.json'), false);
  assert.ok(warnings.some((w) => /publish-controls\.json\.enc/.test(w)), 'warning printed to the console');
});

test('fast-scores.json is always public: exported even when publish controls are invalid', () => {
  writeEnc('fast-scores.json.enc', { scores: [{ name: 'perf', value: 1 }] });
  writeControlsRaw({ collections: 'all-private' });
  const result = run({ allowPartial: true });
  assert.equal(exists('fast-scores.json'), true);
  assert.equal(exists('projects.json'), false, 'gated collections stay withheld');
  assert.equal(result.exitCode, 0);
});

test('partial mode: a missing controls file also exports nothing gated and exits 0', () => {
  fs.rmSync(path.join(encryptedDir, 'publish-controls.json.enc'), { force: true });
  const result = run({ allowPartial: true });
  assert.equal(result.exitCode, 0);
  assert.ok(result.lines.includes(CONTROLS_UNAVAILABLE_WARNING));
  assert.equal(exists('projects.json'), false);
  assert.equal(exists('highlights.json'), false);
});

test('without partial mode, a schema-invalid controls file exits 1', () => {
  writeControlsRaw({});
  const result = run({ allowPartial: false });
  assert.equal(result.exitCode, 1);
});
