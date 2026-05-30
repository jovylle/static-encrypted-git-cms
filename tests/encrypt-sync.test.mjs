import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePlaintext,
  plaintextsMatch,
} from '../scripts/lib/encrypt-sync.mjs';

test('normalizePlaintext strips trailing newlines', () => {
  assert.equal(normalizePlaintext('{"a":1}\n\n'), '{"a":1}');
  assert.equal(normalizePlaintext('{"a":1}'), '{"a":1}');
});

test('plaintextsMatch ignores trailing newline differences', () => {
  assert.equal(plaintextsMatch('{"a":1}\n', '{"a":1}'), true);
  assert.equal(plaintextsMatch('{"a":1}', '{"a":2}'), false);
  assert.equal(plaintextsMatch(null, '{"a":1}'), false);
});
