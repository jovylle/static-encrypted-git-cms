// Worker side of the shared visibility table (tests/fixtures/visibility-cases.json). The export side runs the
// same cases in tests/visibility-parity.test.mjs. Also covers the list and bundle filters used by the live routes.
import { describe, it, expect } from 'vitest';
import cases from '../../../tests/fixtures/visibility-cases.json';
import {
  isPublicBlogPost,
  isPublicItem,
  isPublicNotification,
  publicListPayload,
  publicNotificationBundle,
} from '../src/lib/public-visibility';

const CHECKS: Record<string, (value: any, now?: number) => boolean> = {
  item: isPublicItem,
  blog: isPublicBlogPost,
  notification: (value, now) => isPublicNotification(value, now),
};

describe('shared visibility cases (Worker side)', () => {
  it('covers every kind', () => {
    for (const kind of Object.keys(CHECKS)) {
      expect(cases.cases.some((c) => c.kind === kind)).toBe(true);
    }
  });

  for (const c of cases.cases) {
    it(`${c.id} is ${c.visible ? 'visible' : 'hidden'}`, () => {
      const check = CHECKS[c.kind];
      expect(check, `unknown kind ${c.kind}`).toBeDefined();
      const now = (c as any).now ? Date.parse((c as any).now) : undefined;
      expect(check(structuredClone(c.value), now)).toBe(c.visible);
    });
  }
});

describe('publicListPayload (projects.json and personal-projects.json)', () => {
  it('filters the { projects: [...] } shape the export and the vault actually use', () => {
    const data = {
      projects: [
        { slug: 'public-one', status: 'published', private: false },
        { slug: 'private-one', status: 'published', private: true },
        { slug: 'draft-one', status: 'draft' },
      ],
      version: 3,
    };
    const out = publicListPayload(data);
    expect(out.projects.map((p: any) => p.slug)).toEqual(['public-one']);
    expect(out.version).toBe(3);
  });

  it('still filters a bare array', () => {
    expect(publicListPayload([{ status: 'private' }, { status: 'published' }])).toEqual([
      { status: 'published' },
    ]);
  });

  it('returns other shapes unchanged', () => {
    expect(publicListPayload({ items: [1] })).toEqual({ items: [1] });
    expect(publicListPayload(null)).toBeNull();
  });
});

describe('publicNotificationBundle (raw shape kept)', () => {
  it('drops hidden and expired notifications and keeps every other field', () => {
    const bundle = {
      version: 1,
      notifications: [
        { id: 'keep', status: 'published', message: 'hi', tags: ['all'] },
        { id: 'draft', status: 'draft' },
        { id: 'private', private: true },
        { id: 'expired', expiresAt: '2020-01-01T00:00:00Z' },
      ],
    };
    const out = publicNotificationBundle(bundle);
    expect(out.version).toBe(1);
    expect(out.notifications).toEqual([
      { id: 'keep', status: 'published', message: 'hi', tags: ['all'] },
    ]);
  });

  it('uses the supplied clock for expiry', () => {
    const item = { id: 'soon', expiresAt: '2030-01-01T00:00:00Z' };
    expect(isPublicNotification(item, Date.parse('2029-12-31T00:00:00Z'))).toBe(true);
    expect(isPublicNotification(item, Date.parse('2030-01-02T00:00:00Z'))).toBe(false);
  });

  it('returns a payload without a notifications array unchanged', () => {
    expect(publicNotificationBundle({ other: true })).toEqual({ other: true });
  });
});
