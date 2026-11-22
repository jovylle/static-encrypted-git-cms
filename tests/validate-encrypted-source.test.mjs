// data:validate rule: a manifest collection with an encrypted file but no plaintext source is a FAIL.
// A collection with neither file is a plain SKIP. Uses temp dirs only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateSourceData } from '../scripts/lib/validate-data.mjs';

function makeDirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-enc-'));
  const sourceDir = path.join(root, 'source');
  const encryptedDir = path.join(root, 'encrypted');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(encryptedDir, { recursive: true });
  return { root, sourceDir, encryptedDir };
}

test('encrypted file present but plaintext source missing is a FAIL, not a SKIP', async () => {
  const { root, sourceDir, encryptedDir } = makeDirs();
  try {
    fs.writeFileSync(path.join(encryptedDir, 'profile.json.enc'), '{"v":1}', 'utf8');
    const result = await validateSourceData(
      { collections: [{ id: 'profile', source: 'profile.json', schema: 'profile.schema.json' }] },
      { sourceDir, encryptedDir },
    );
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((l) => l.startsWith('FAIL profile: profile.json is encrypted')));
    assert.ok(!result.errors.some((l) => l.startsWith('SKIP profile')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('collection with neither encrypted file nor source is a plain SKIP', async () => {
  const { root, sourceDir, encryptedDir } = makeDirs();
  try {
    const result = await validateSourceData(
      { collections: [{ id: 'uses', source: 'uses.json', schema: 'uses.schema.json' }] },
      { sourceDir, encryptedDir },
    );
    assert.ok(result.errors.includes('SKIP uses: no uses.json and no encrypted file'));
    assert.equal(result.ok, false, 'zero checked collections still fails');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('blog directory: an encrypted post with no plaintext source is a FAIL', async () => {
  const { root, sourceDir, encryptedDir } = makeDirs();
  try {
    fs.mkdirSync(path.join(encryptedDir, 'blogs'));
    fs.writeFileSync(path.join(encryptedDir, 'blogs', 'post-a.json.enc'), '{"v":1}', 'utf8');
    const result = await validateSourceData(
      { collections: [{ id: 'blog-post', source: 'blogs/*.json', schema: 'blog-post.schema.json' }] },
      { sourceDir, encryptedDir },
    );
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((l) => l.startsWith('FAIL blog-post: blogs/post-a.json is encrypted')),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
