// Worker copy of the static export's visibility rules (scripts/lib/public-filter.mjs). The semantics must stay
// identical: tests/fixtures/visibility-cases.json is asserted by both sides (packages/api/test/visibility-parity
// and tests/visibility-parity.test.mjs), so drift fails a test.
//
// Rules:
// - Items: hidden when status is 'draft' or 'private', or private === true.
// - Blog posts: an item rule, plus top-level draft === true, plus frontmatter `draft: true` in the body.
//   parseFrontmatter() is a port of the export's parser, including its quoting and boolean rules.
// - Notifications: an item rule, plus expiresAt in the past. The clock is Date.now() (the export uses new Date()).
//   An unparseable expiresAt is kept, as in the export.
// - Notification bundles keep their raw shape. Only the notifications array is filtered.

export function parseFrontmatter(markdown: unknown): Record<string, unknown> {
  const text = typeof markdown === 'string' ? markdown : '';
  const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) return {};

  const frontmatter: Record<string, unknown> = {};
  for (const line of match[1].split('\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex <= 0) continue;
    const key = line.substring(0, colonIndex).trim();
    let value: unknown = line.substring(colonIndex + 1).trim();
    if (typeof value === 'string' && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    } else if (value === 'true') value = true;
    else if (value === 'false') value = false;
    frontmatter[key] = value;
  }
  return frontmatter;
}

export function isPublicItem(item: any): boolean {
  if (!item || typeof item !== 'object') return false;
  if (item.status === 'draft' || item.status === 'private') return false;
  if (item.private === true) return false;
  return true;
}

export function isPublicBlogPost(post: any): boolean {
  if (!post || typeof post !== 'object') return false;
  if (!isPublicItem(post)) return false;
  if (post.draft === true) return false;
  const fm = parseFrontmatter(post.body);
  if (fm.draft === true || fm.draft === 'true') return false;
  return true;
}

export function isPublicNotification(item: any, now: number = Date.now()): boolean {
  if (!isPublicItem(item)) return false;
  if (item.expiresAt) {
    const exp = new Date(item.expiresAt).getTime();
    if (!Number.isNaN(exp) && exp < now) return false;
  }
  return true;
}

/**
 * Root list collections (projects.json, personal-projects.json). The file is { projects: [...] }; a bare
 * array is accepted too. Other shapes are returned unchanged.
 */
export function publicListPayload(data: any): any {
  if (Array.isArray(data)) return data.filter(isPublicItem);
  if (data && typeof data === 'object' && Array.isArray(data.projects)) {
    return { ...data, projects: data.projects.filter(isPublicItem) };
  }
  return data;
}

/** Notification bundle { notifications: [...] }: hide non-public items, keep every other field. */
export function publicNotificationBundle(data: any, now: number = Date.now()): any {
  if (!data || typeof data !== 'object' || !Array.isArray(data.notifications)) return data;
  return {
    ...data,
    notifications: data.notifications.filter((n: any) => isPublicNotification(n, now)),
  };
}
