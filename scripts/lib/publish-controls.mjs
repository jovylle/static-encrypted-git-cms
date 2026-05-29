const DEFAULT_CONTROLS = Object.freeze({
  personal_projects_public: true,
});

export function normalizePublishControls(data) {
  if (!data || typeof data !== 'object') {
    return { ...DEFAULT_CONTROLS };
  }
  return {
    personal_projects_public:
      typeof data.personal_projects_public === 'boolean'
        ? data.personal_projects_public
        : true,
  };
}

export function shouldExportCollection(controls, collectionId) {
  const normalized = normalizePublishControls(controls);
  if (collectionId === 'personal-projects') {
    return normalized.personal_projects_public;
  }
  return true;
}
