// Uses temp directories and a throwaway key only. Never touches data/encrypted/ or data/source/.
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decryptJson } from '../scripts/lib/content-crypto.mjs';
import {
  ExistingCiphertextError,
  checkEncryptPreflight,
  encryptSourceFile,
  findUnreadableCiphertext,
  readEncryptedPlaintext,
  writeEncryptedText,
} from '../scripts/lib/encrypt-sync.mjs';

const KEY_A = 'throwaway-test-key-AAAAAAAA';
const KEY_B = 'throwaway-test-key-BBBBBBBB';
const REL = 'profile.json';
const SOURCE_TEXT = '{"name":"test"}\n';

let savedKey;
let root;
let sourceDir;
let encryptedDir;

function setKey(value) {
  process.env.CONTENT_DECRYPT_KEY = value;
}

function encPath() {
  return path.join(encryptedDir, 'profile.json.enc');
}

beforeEach(() => {
  savedKey = process.env.CONTENT_DECRYPT_KEY;
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'encrypt-sync-test-'));
  sourceDir = path.join(root, 'source');
  encryptedDir = path.join(root, 'encrypted');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(encryptedDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, REL), SOURCE_TEXT, 'utf8');
  setKey(KEY_A);
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.CONTENT_DECRYPT_KEY;
  else process.env.CONTENT_DECRYPT_KEY = savedKey;
  fs.rmSync(root, { recursive: true, force: true });
});

test('a missing .enc is a normal create', () => {
  const result = encryptSourceFile(REL, { sourceDir, encryptedDir });
  assert.equal(result, 'created');
  assert.equal(decryptJson(fs.readFileSync(encPath(), 'utf8').trim()), SOURCE_TEXT);
});

test('an existing .enc that decrypts to the same text is skipped and left byte-identical', () => {
  encryptSourceFile(REL, { sourceDir, encryptedDir });
  const before = fs.readFileSync(encPath(), 'utf8');
  assert.equal(encryptSourceFile(REL, { sourceDir, encryptedDir }), 'skipped');
  assert.equal(fs.readFileSync(encPath(), 'utf8'), before);
});

test('an existing .enc with different readable plaintext is updated', () => {
  encryptSourceFile(REL, { sourceDir, encryptedDir });
  fs.writeFileSync(path.join(sourceDir, REL), '{"name":"changed"}\n', 'utf8');
  assert.equal(encryptSourceFile(REL, { sourceDir, encryptedDir }), 'updated');
  assert.equal(
    decryptJson(fs.readFileSync(encPath(), 'utf8').trim()),
    '{"name":"changed"}\n',
  );
});

test('wrong key: existing .enc throws and is NOT overwritten', () => {
  encryptSourceFile(REL, { sourceDir, encryptedDir }); // committed under KEY_A
  const committed = fs.readFileSync(encPath(), 'utf8');

  setKey(KEY_B);
  assert.throws(
    () => encryptSourceFile(REL, { sourceDir, encryptedDir }),
    (err) => {
      assert.ok(err instanceof ExistingCiphertextError);
      assert.match(err.message, /NOT overwritten/);
      assert.match(err.message, /--force/);
      return true;
    },
  );
  assert.equal(fs.readFileSync(encPath(), 'utf8'), committed);
});

test('wrong key with force: the .enc is replaced and reported as updated', () => {
  encryptSourceFile(REL, { sourceDir, encryptedDir }); // committed under KEY_A
  setKey(KEY_B);
  assert.equal(
    encryptSourceFile(REL, { sourceDir, encryptedDir, force: true }),
    'updated',
  );
  assert.equal(decryptJson(fs.readFileSync(encPath(), 'utf8').trim()), SOURCE_TEXT);
});

test('a corrupt or empty existing .enc throws unless force is passed', () => {
  fs.writeFileSync(encPath(), 'not json at all', 'utf8');
  assert.throws(() => encryptSourceFile(REL, { sourceDir, encryptedDir }), ExistingCiphertextError);
  assert.equal(fs.readFileSync(encPath(), 'utf8'), 'not json at all');

  fs.writeFileSync(encPath(), '', 'utf8');
  assert.throws(() => encryptSourceFile(REL, { sourceDir, encryptedDir }), ExistingCiphertextError);
  assert.equal(fs.readFileSync(encPath(), 'utf8'), '');

  assert.equal(encryptSourceFile(REL, { sourceDir, encryptedDir, force: true }), 'updated');
});

test('a missing CONTENT_DECRYPT_KEY with an existing .enc throws and writes nothing', () => {
  encryptSourceFile(REL, { sourceDir, encryptedDir });
  const committed = fs.readFileSync(encPath(), 'utf8');
  delete process.env.CONTENT_DECRYPT_KEY;
  assert.throws(
    () => encryptSourceFile(REL, { sourceDir, encryptedDir }),
    (err) => err instanceof ExistingCiphertextError && /CONTENT_DECRYPT_KEY/.test(err.reason),
  );
  assert.equal(fs.readFileSync(encPath(), 'utf8'), committed);
});

test('readEncryptedPlaintext returns null when no .enc exists', () => {
  assert.equal(readEncryptedPlaintext(REL, { encryptedDir }), null);
});

test('findUnreadableCiphertext lists only the .enc files this key cannot read', () => {
  encryptSourceFile(REL, { sourceDir, encryptedDir }); // readable under KEY_A
  fs.writeFileSync(path.join(encryptedDir, 'resume.json.enc'), 'garbage', 'utf8');

  const unreadable = findUnreadableCiphertext(
    [REL, 'resume.json', 'highlights.json'],
    { encryptedDir },
  );
  assert.deepEqual(
    unreadable.map((u) => u.rel),
    ['resume.json'],
  );
  assert.ok(unreadable[0].reason.length > 0);
});

// Batch write as data-encrypt.mjs does it: preflight first, then encrypt each file.
function runBatch(rels, options) {
  const blocked = checkEncryptPreflight(rels, { ...options, encryptedDir });
  if (blocked.length > 0) return { blocked, results: [] };
  const results = rels.map((rel) => encryptSourceFile(rel, { ...options, sourceDir, encryptedDir }));
  return { blocked, results };
}

test('batch: nothing is written if any existing .enc fails to decrypt', () => {
  // resume.json is committed under KEY_B (wrong key for this run). profile.json is new (would be created).
  setKey(KEY_B);
  fs.writeFileSync(path.join(sourceDir, 'resume.json'), '{"r":1}\n', 'utf8');
  encryptSourceFile('resume.json', { sourceDir, encryptedDir });
  const committedResume = fs.readFileSync(path.join(encryptedDir, 'resume.json.enc'), 'utf8');
  fs.writeFileSync(path.join(sourceDir, 'highlights.json'), '{"h":1}\n', 'utf8');
  setKey(KEY_A);

  const { blocked, results } = runBatch([REL, 'resume.json', 'highlights.json']);

  assert.deepEqual(blocked.map((b) => b.rel), ['resume.json']);
  assert.deepEqual(results, [], 'no file may be encrypted when the preflight blocks');
  assert.equal(fs.existsSync(encPath()), false, 'profile.json.enc must not be created');
  assert.equal(fs.existsSync(path.join(encryptedDir, 'highlights.json.enc')), false);
  assert.equal(fs.readFileSync(path.join(encryptedDir, 'resume.json.enc'), 'utf8'), committedResume);
});

test('batch: with force the preflight is skipped and every file is written', () => {
  setKey(KEY_B);
  fs.writeFileSync(path.join(sourceDir, 'resume.json'), '{"r":1}\n', 'utf8');
  encryptSourceFile('resume.json', { sourceDir, encryptedDir });
  setKey(KEY_A);

  const { blocked, results } = runBatch([REL, 'resume.json'], { force: true });

  assert.deepEqual(blocked, []);
  assert.deepEqual(results, ['created', 'updated']);
});

test('writeEncryptedText creates a missing .enc', () => {
  writeEncryptedText(REL, SOURCE_TEXT, { encryptedDir });
  assert.equal(decryptJson(fs.readFileSync(encPath(), 'utf8').trim()), SOURCE_TEXT);
});

test('writeEncryptedText refuses to replace an .enc this key cannot read, and leaves it byte-identical', () => {
  encryptSourceFile(REL, { sourceDir, encryptedDir }); // committed under KEY_A
  const committed = fs.readFileSync(encPath(), 'utf8');
  setKey(KEY_B);
  assert.throws(
    () => writeEncryptedText(REL, '{"name":"wrong-key"}\n', { encryptedDir }),
    ExistingCiphertextError,
  );
  assert.equal(fs.readFileSync(encPath(), 'utf8'), committed);
});

test('writeEncryptedText with force replaces an unreadable .enc', () => {
  encryptSourceFile(REL, { sourceDir, encryptedDir }); // committed under KEY_A
  setKey(KEY_B);
  writeEncryptedText(REL, '{"name":"forced"}\n', { encryptedDir, force: true });
  assert.equal(decryptJson(fs.readFileSync(encPath(), 'utf8').trim()), '{"name":"forced"}\n');
});

test('checkEncryptPreflight with force reports nothing', () => {
  fs.writeFileSync(encPath(), 'garbage', 'utf8');
  assert.deepEqual(checkEncryptPreflight([REL], { encryptedDir, force: true }), []);
  assert.equal(checkEncryptPreflight([REL], { encryptedDir }).length, 1);
});
