/** Parse YAML-like frontmatter from markdown body (legacy blog format). */
export function parseFrontmatter(markdown) {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = (markdown || '').match(frontmatterRegex);
  if (!match) return {};

  const frontmatter = {};
  match[1].split('\n').forEach((line) => {
    const colonIndex = line.indexOf(':');
    if (colonIndex <= 0) return;
    const key = line.substring(0, colonIndex).trim();
    let value = line.substring(colonIndex + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    } else if (value === 'true') value = true;
    else if (value === 'false') value = false;
    frontmatter[key] = value;
  });
  return frontmatter;
}

export function isPublicItem(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.status === 'draft') return false;
  if (item.private === true) return false;
  return true;
}

export function isPublicBlogPost(post) {
  if (!post || typeof post !== 'object') return false;
  if (!isPublicItem(post)) return false;
  const fm = parseFrontmatter(post.body || '');
  if (fm.draft === true || fm.draft === 'true') return false;
  return true;
}

/** Filter list collections: projects, personal-projects. */
export function filterListCollection(data, listKey) {
  if (!data || !Array.isArray(data[listKey])) return data;
  return {
    ...data,
    [listKey]: data[listKey].filter(isPublicItem),
  };
}
