export const PROJECT_STATUS_VALUES = new Set(['published', 'draft', 'private']);
export const COLLECTION_STATUS_VALUES = new Set(['public', 'draft', 'private']);
export const MANAGED_COLLECTION_IDS = new Set([
  'personal-projects',
  'projects',
  'highlights',
  'profile',
  'resume',
  'blogs',
]);

export function applyProjectVisibilityUpdate(data, update) {
  if (!data || !Array.isArray(data.projects)) {
    throw new Error('personal-projects data is invalid (missing projects array).');
  }

  const slug = String(update.slug || '').trim();
  if (!slug) throw new Error('slug is required');

  const project = data.projects.find((p) => p && p.slug === slug);
  if (!project) {
    throw new Error(`Project not found: ${slug}`);
  }

  if (update.status !== undefined) {
    if (!PROJECT_STATUS_VALUES.has(update.status)) {
      throw new Error('status must be "published", "draft", or "private"');
    }
    project.status = update.status;
  }
  if (update.private !== undefined) {
    if (typeof update.private !== 'boolean') {
      throw new Error('private must be boolean');
    }
    project.private = update.private;
  }
  return project;
}

export function normalizePublishControls(data) {
  const collections = {
    'personal-projects': 'public',
    projects: 'public',
    highlights: 'public',
    profile: 'public',
    resume: 'public',
    blogs: 'public',
  };

  if (data && typeof data === 'object') {
    if (typeof data.personal_projects_public === 'boolean') {
      collections['personal-projects'] = data.personal_projects_public ? 'public' : 'private';
    }
    if (data.collections && typeof data.collections === 'object') {
      for (const key of Object.keys(collections)) {
        const value = data.collections[key];
        if (COLLECTION_STATUS_VALUES.has(value)) {
          collections[key] = value;
        }
      }
    }
  }

  return {
    collections,
  };
}

export function applyCollectionVisibilityUpdate(data, update) {
  const controls = normalizePublishControls(data);

  // Backward compatibility for existing checkbox caller.
  if (typeof update.personal_projects_public === 'boolean') {
    controls.collections['personal-projects'] = update.personal_projects_public
      ? 'public'
      : 'private';
    return controls;
  }

  const collection = String(update.collection || '').trim();
  const status = String(update.status || '').trim();

  if (!MANAGED_COLLECTION_IDS.has(collection)) {
    throw new Error('collection must be one of personal-projects, projects, highlights, profile, resume, blogs');
  }
  if (!COLLECTION_STATUS_VALUES.has(status)) {
    throw new Error('status must be "public", "draft", or "private"');
  }

  controls.collections[collection] = status;
  return controls;
}
