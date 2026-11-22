// Export side of the shared visibility table. The same cases run in packages/api/test/visibility-parity.test.ts
// against the Worker copy. If one side changes, the other side's test fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isPublicBlogPost,
  isPublicItem,
  isPublicNotification,
} from '../scripts/lib/public-filter.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { cases } = JSON.parse(
  fs.readFileSync(path.join(here, 'fixtures', 'visibility-cases.json'), 'utf8'),
);

const CHECKS = {
  item: isPublicItem,
  blog: isPublicBlogPost,
  notification: isPublicNotification,
};

test('visibility fixture table is non-trivial and covers every kind', () => {
  assert.ok(cases.length >= 15);
  for (const kind of Object.keys(CHECKS)) {
    assert.ok(cases.some((c) => c.kind === kind), `no case for ${kind}`);
  }
});

for (const c of cases) {
  test(`export visibility: ${c.id} is ${c.visible ? 'visible' : 'hidden'}`, () => {
    const check = CHECKS[c.kind];
    assert.ok(check, `unknown kind ${c.kind}`);
    const now = c.now ? Date.parse(c.now) : undefined;
    assert.equal(check(structuredClone(c.value), now), c.visible);
  });
}
