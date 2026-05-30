const EDITABLE_COLLECTIONS = [
  {
    key: 'personal-projects',
    label: 'Personal Projects',
    filePath: 'data/encrypted/personal-projects.json.enc',
  },
  {
    key: 'projects',
    label: 'Projects',
    filePath: 'data/encrypted/projects.json.enc',
  },
  {
    key: 'highlights',
    label: 'Highlights',
    filePath: 'data/encrypted/highlights.json.enc',
  },
  {
    key: 'profile',
    label: 'Profile',
    filePath: 'data/encrypted/profile.json.enc',
  },
  {
    key: 'resume',
    label: 'Resume',
    filePath: 'data/encrypted/resume.json.enc',
  },
  {
    key: 'publish-controls',
    label: 'Publish Controls',
    filePath: 'data/encrypted/publish-controls.json.enc',
  },
];

const byKey = new Map(EDITABLE_COLLECTIONS.map((item) => [item.key, item]));

export function listAdminCollections() {
  return EDITABLE_COLLECTIONS.map(({ key, label }) => ({ key, label }));
}

export function getAdminCollectionByKey(key) {
  return byKey.get(String(key || '').trim()) || null;
}
