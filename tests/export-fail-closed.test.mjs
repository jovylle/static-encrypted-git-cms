// Runs the real export core (scripts/lib/export-public.mjs) against temp directories and a throwaway key.
// Never touches data/encrypted/, data/source/ or public/. The key is set only inside this file.
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { encryptJson } from '../scripts/lib/content-crypto.mjs';
import { CONTROLS_UNAVAILABLE_WARNING, exportPublicData } from '../scripts/lib/export-public.mjs';
import { loadPublishControls } from '../scripts/lib/export-gate.mjs';

const KEY = 'throwaway-export-key-AAAAAAAA';
const OTHER_KEY = 'throwaway-export-key-BBBBBBBB';

let savedKey;
let root;
let encryptedDir;
let publicDataDir;
let publicNotificationsDir;

function writeEnc(rel, obj, key = KEY) {
  process.env.CONTENT_DECRYPT_KEY = key;
  const full = path.join(encryptedDir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, `${encryptJson(JSON.stringify(obj))}\n`, 'utf8');
  process.env.CONTENT_DECRYPT_KEY = KEY;
}

// The strict schema needs all 10 collection ids; unlisted ones are written as public.
function writeControls(collections) {
  const all = Object.fromEntries(
    ['personal-projects', 'projects', 'highlights', 'profile', 'resume', 'blogs', 'notifications', 'homepage', 'social', 'uses'].map(
      (id) => [id, 'public'],
    ),
  );
  writeEnc('publish-controls.json.enc', { collections: { ...all, ...collections } });
}

/** A full, valid vault: projects is private, highlights and blogs are public. */
function seedVault() {
  writeEnc('projects.json.enc', {
    projects: [{ slug: 'secret', title: 'Secret', status: 'published', private: false }],
  });
  writeEnc('highlights.json.enc', { items: [{ title: 'Highlight' }] });
  writeEnc('blogs/post-a.json.enc', { title: 'Post A', body: 'Hello' });
  writeEnc('notifications/2026-01-01.json.enc', {
    notifications: [{ id: 'n1', title: 'Hi', message: 'm', status: 'published' }],
  });
  writeControls({ projects: 'private', highlights: 'public', blogs: 'public', notifications: 'public' });
}

function run(opts = {}) {
  return exportPublicData({ encryptedDir, publicDataDir, publicNotificationsDir, ...opts });
}

function exists(...parts) {
  return fs.existsSync(path.join(publicDataDir, ...parts));
}

beforeEach(() => {
  savedKey = process.env.CONTENT_DECRYPT_KEY;
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'export-fail-closed-'));
  encryptedDir = path.join(root, 'encrypted');
  publicDataDir = path.join(root, 'public', 'data');
  publicNotificationsDir = path.join(root, 'public', 'notifications');
  fs.mkdirSync(encryptedDir, { recursive: true });
  fs.mkdirSync(publicDataDir, { recursive: true });
  fs.mkdirSync(publicNotificationsDir, { recursive: true });
  process.env.CONTENT_DECRYPT_KEY = KEY;
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.CONTENT_DECRYPT_KEY;
  else process.env.CONTENT_DECRYPT_KEY = savedKey;
  fs.rmSync(root, { recursive: true, force: true });
});

test('publish-controls missing -> exit 1, nothing exported (not all-public)', () => {
  seedVault();
  fs.rmSync(path.join(encryptedDir, 'publish-controls.json.enc'));

  const result = run();

  assert.equal(result.exitCode, 1);
  assert.match(result.lines.join('\n'), /publish-controls\.json\.enc: missing encrypted file/);
  assert.deepEqual(result.exported, []);
  assert.equal(exists('highlights.json'), false);
  assert.equal(exists('projects.json'), false);
  assert.equal(exists('blogs'), false);
});

test('publish-controls 0 bytes -> exit 1, nothing exported', () => {
  seedVault();
  fs.writeFileSync(path.join(encryptedDir, 'publish-controls.json.enc'), '');

  const result = run();

  assert.equal(result.exitCode, 1);
  assert.match(result.lines.join('\n'), /empty encrypted file/);
  assert.deepEqual(result.exported, []);
});

test('publish-controls undecryptable (wrong key) -> exit 1, nothing exported', () => {
  seedVault();
  writeEnc('publish-controls.json.enc', { collections: { highlights: 'public' } }, OTHER_KEY);

  const result = run();

  assert.equal(result.exitCode, 1);
  assert.match(result.lines.join('\n'), /publish-controls\.json\.enc: decrypt or parse failed/);
  assert.deepEqual(result.exported, []);
});

test('publish-controls valid: private collection is not exported, public one is', () => {
  seedVault();

  const result = run();

  assert.equal(result.exitCode, 0);
  assert.equal(exists('projects.json'), false, 'private projects must not be exported');
  assert.equal(exists('highlights.json'), true, 'public highlights must be exported');
  assert.equal(exists('blogs', 'post-a.json'), true, 'public blogs must be exported');
  assert.equal(
    fs.existsSync(path.join(publicNotificationsDir, '2026-01-01.json')),
    true,
    'public notifications must be exported',
  );
});

test('publish-controls valid but notifications private: no notification output', () => {
  seedVault();
  writeControls({ projects: 'public', highlights: 'public', blogs: 'public', notifications: 'private' });

  const result = run();

  assert.equal(result.exitCode, 0);
  assert.equal(exists('notifications.json'), false);
  assert.equal(fs.readdirSync(publicNotificationsDir).length, 0);
});

test('ALLOW_PARTIAL_EXPORT with publish-controls missing -> exit 0 with loud warning, nothing gated exported', () => {
  seedVault();
  fs.rmSync(path.join(encryptedDir, 'publish-controls.json.enc'));

  const result = run({ allowPartial: true });

  assert.equal(result.exitCode, 0);
  assert.ok(result.lines.includes(CONTROLS_UNAVAILABLE_WARNING), 'expected the controls warning line');
  assert.deepEqual(result.exported, [], 'no collection may be exported without controls');
  assert.equal(exists('projects.json'), false);
  assert.equal(exists('highlights.json'), false);
  assert.equal(exists('fast-scores.json'), false, 'unknown collections are not exported either');
  assert.equal(exists('blogs'), false);
  assert.equal(exists('notifications.json'), false);
});

test('ALLOW_PARTIAL_EXPORT with a corrupt collection still exports the rest (exit 0)', () => {
  seedVault();
  fs.writeFileSync(path.join(encryptedDir, 'highlights.json.enc'), '{"v":1,"iv":"x"}');

  const result = run({ allowPartial: true });

  assert.equal(result.exitCode, 0);
  assert.match(result.lines.join('\n'), /highlights\.json\.enc/);
  assert.equal(exists('highlights.json'), false);
  assert.equal(exists('blogs', 'post-a.json'), true);
});

test('a corrupt collection without ALLOW_PARTIAL_EXPORT -> exit 1 and the file is named', () => {
  seedVault();
  fs.writeFileSync(path.join(encryptedDir, 'highlights.json.enc'), '{"v":1,"iv":"x"}');

  const result = run();

  assert.equal(result.exitCode, 1);
  assert.match(result.lines.join('\n'), /highlights\.json\.enc/);
});

test('missing content key -> one message, exit 1 even with ALLOW_PARTIAL_EXPORT, and nothing is wiped', () => {
  seedVault();
  const sentinel = path.join(publicDataDir, 'keep-me.json');
  fs.writeFileSync(sentinel, '{}');
  delete process.env.CONTENT_DECRYPT_KEY;

  const result = run({ allowPartial: true });

  assert.equal(result.exitCode, 1);
  assert.equal(result.lines.length, 1, 'exactly one message, not one per file');
  assert.match(result.lines[0], /CONTENT_DECRYPT_KEY/);
  assert.match(result.lines[0], /Nothing was exported/);
  assert.deepEqual(result.exported, []);
  assert.equal(fs.existsSync(sentinel), true, 'public output must not be wiped when the key is missing');
});

test('loadPublishControls reports every unusable state as a failure', () => {
  seedVault();
  const file = path.join(encryptedDir, 'publish-controls.json.enc');

  assert.equal(loadPublishControls({ encryptedDir }).failure, null);

  fs.writeFileSync(file, '');
  assert.ok(loadPublishControls({ encryptedDir }).failure);

  writeEnc('publish-controls.json.enc', ['not', 'an', 'object']);
  assert.match(loadPublishControls({ encryptedDir }).failure.message, /not a JSON object/);

  fs.rmSync(file);
  assert.ok(loadPublishControls({ encryptedDir }).failure);
});
