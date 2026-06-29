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
  if (item.status === 'draft' || item.status === 'private') return false;
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

/** Published personal projects: higher priority_score first, then updated_at. */
export function sortPersonalProjects(data) {
  if (!data?.projects) return data;
  const projects = [...data.projects].sort((a, b) => {
    const ps = (b.priority_score ?? 0) - (a.priority_score ?? 0);
    if (ps !== 0) return ps;
    return (b.updated_at || '').localeCompare(a.updated_at || '');
  });
  return { ...data, projects };
}

export function isPublicNotification(item) {
  if (!isPublicItem(item)) return false;
  if (item.expiresAt) {
    const exp = new Date(item.expiresAt);
    if (!Number.isNaN(exp.getTime()) && exp < new Date()) return false;
  }
  return true;
}

function widgetNotificationType(type) {
  if (type === 'announcement') return 'success';
  return type || 'info';
}

/** Shape for widget Alerts tab (embed-inline.js). */
export function toWidgetNotification(item) {
  const date =
    item.date ||
    (item.timestamp && String(item.timestamp).slice(0, 10)) ||
    '';
  const timestamp =
    item.timestamp ||
    (date ? `${date}T12:00:00Z` : new Date().toISOString());
  let message = item.message || '';
  if (item.link?.url && !message.includes(item.link.url)) {
    const label = item.link.label ? `${item.link.label}: ` : '';
    message = `${message} ${label}${item.link.url}`.trim();
  }
  return {
    id: item.id,
    type: widgetNotificationType(item.type),
    title: item.title,
    message,
    tags: Array.isArray(item.tags) && item.tags.length ? item.tags : ['all'],
    persistent: item.persistent ?? false,
    timestamp,
  };
}

export function filterNotificationBundle(bundle) {
  if (!bundle || !Array.isArray(bundle.notifications)) {
    return { notifications: [] };
  }
  return {
    notifications: bundle.notifications
      .filter(isPublicNotification)
      .map(toWidgetNotification),
  };
}

export function flattenNotificationsForCms(bundles) {
  const byId = new Map();
  for (const bundle of bundles) {
    if (!bundle?.notifications) continue;
    for (const item of bundle.notifications) {
      if (!isPublicNotification(item)) continue;
      byId.set(item.id, {
        id: item.id,
        title: item.title,
        message: item.message,
        type: item.type || 'info',
        status: item.status || 'published',
        private: item.private === true,
        date: item.date || (item.timestamp ? String(item.timestamp).slice(0, 10) : ''),
        expiresAt: item.expiresAt ?? null,
        link: item.link,
        tags: item.tags,
      });
    }
  }
  const notifications = [...byId.values()].sort((a, b) =>
    (b.date || '').localeCompare(a.date || ''),
  );
  return { notifications };
}
