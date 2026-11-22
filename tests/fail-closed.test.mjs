import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOW_PARTIAL_ENV,
  isPartialAllowed,
  summarizeDecryptFailures,
} from '../scripts/lib/decrypt-report.mjs';
import { validateSourceData } from '../scripts/lib/validate-data.mjs';

test('no decrypt failures means exit 0 and no report lines', () => {
  assert.deepEqual(summarizeDecryptFailures([]), { exitCode: 0, lines: [] });
});

test('any decrypt failure exits 1 and names every failing file', () => {
  const failures = [
    { file: 'projects.json.enc', message: 'Unsupported state or unable to authenticate data' },
    { file: 'blogs/a.json.enc', message: 'Unexpected token' },
  ];
  const report = summarizeDecryptFailures(failures, { action: 'export' });
  assert.equal(report.exitCode, 1);
  const text = report.lines.join('\n');
  assert.match(text, /2 encrypted file\(s\) failed/);
  assert.match(text, /projects\.json\.enc/);
  assert.match(text, /blogs\/a\.json\.enc/);
  assert.match(text, /CONTENT_DECRYPT_KEY/);
  assert.match(text, new RegExp(ALLOW_PARTIAL_ENV));
});

test('decrypt action wording says Decrypt failed', () => {
  const report = summarizeDecryptFailures([{ file: 'x.json.enc', message: 'bad' }], {
    action: 'decrypt',
  });
  assert.match(report.lines.join('\n'), /Decrypt failed \(exit 1\)/);
});

test('ALLOW_PARTIAL_EXPORT=1 turns failures into exit 0 with a warning line', () => {
  const report = summarizeDecryptFailures([{ file: 'x.json.enc', message: 'bad' }], {
    allowPartial: true,
  });
  assert.equal(report.exitCode, 0);
  assert.match(report.lines.join('\n'), /ALLOW_PARTIAL_EXPORT=1 is set/);
});

test('only the exact value 1 enables partial export', () => {
  assert.equal(isPartialAllowed({ ALLOW_PARTIAL_EXPORT: '1' }), true);
  assert.equal(isPartialAllowed({ ALLOW_PARTIAL_EXPORT: '0' }), false);
  assert.equal(isPartialAllowed({ ALLOW_PARTIAL_EXPORT: 'true' }), false);
  assert.equal(isPartialAllowed({}), false);
});

test('validateSourceData fails when the manifest finds zero source files', async () => {
  const result = await validateSourceData({
    collections: [
      { id: 'missing-a', source: 'no-such-file-a.json', schema: 'projects.schema.json' },
      { id: 'missing-b', source: 'no-such-dir/*.json', schema: 'blog-post.schema.json' },
    ],
  });
  assert.equal(result.ok, false);
  const error = result.errors.find((line) => line.startsWith('ERROR no collections found'));
  assert.ok(error, 'expected a "no collections found" error');
  assert.match(error, /CONTENT_DECRYPT_KEY/);
});

test('validateSourceData fails for an empty manifest', async () => {
  const result = await validateSourceData({ collections: [] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((line) => line.startsWith('ERROR no collections found')));
});
