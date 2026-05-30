export const COLLECTION_STATUS_VALUES = new Set(['public', 'draft', 'private']);

export const COLLECTION_IDS = Object.freeze([
  'personal-projects',
  'projects',
  'highlights',
  'profile',
  'resume',
  'blogs',
  'notifications',
]);

const DEFAULT_COLLECTIONS = Object.freeze(
  COLLECTION_IDS.reduce((acc, id) => {
    acc[id] = 'public';
    return acc;
  }, {}),
);

export function normalizePublishControls(data) {
  const collections = { ...DEFAULT_COLLECTIONS };

  if (data && typeof data === 'object') {
    if (typeof data.personal_projects_public === 'boolean') {
      collections['personal-projects'] = data.personal_projects_public ? 'public' : 'private';
    }
    if (data.collections && typeof data.collections === 'object') {
      for (const id of COLLECTION_IDS) {
        const value = data.collections[id];
        if (COLLECTION_STATUS_VALUES.has(value)) {
          collections[id] = value;
        }
      }
    }
  }

  return {
    collections,
  };
}

export function getCollectionStatus(controls, collectionId) {
  const normalized = normalizePublishControls(controls);
  return normalized.collections[collectionId] || 'public';
}

export function shouldExportCollection(controls, collectionId) {
  return getCollectionStatus(controls, collectionId) === 'public';
}
