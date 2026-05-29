export const PROJECT_STATUS_VALUES = new Set(['published', 'draft', 'private']);

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
  if (!data || typeof data !== 'object') {
    return { personal_projects_public: true };
  }
  return {
    personal_projects_public:
      typeof data.personal_projects_public === 'boolean'
        ? data.personal_projects_public
        : true,
  };
}

export function applyCollectionVisibilityUpdate(data, update) {
  const controls = normalizePublishControls(data);
  if (typeof update.personal_projects_public !== 'boolean') {
    throw new Error('personal_projects_public must be boolean');
  }
  controls.personal_projects_public = update.personal_projects_public;
  return controls;
}
