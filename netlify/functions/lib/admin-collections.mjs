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
    key: 'notifications',
    label: 'Notifications',
    multiFile: true,
    dirPath: 'data/encrypted/notifications',
  },
  {
    key: 'publish-controls',
    label: 'Publish Controls',
    filePath: 'data/encrypted/publish-controls.json.enc',
  },
  {
    key: 'blogs',
    label: 'Blog posts',
    multiFile: true,
    dirPath: 'data/encrypted/blogs',
  },
];

const byKey = new Map(EDITABLE_COLLECTIONS.map((item) => [item.key, item]));

/** Default when publish-controls.json.enc is not in git yet. */
export const DEFAULT_PUBLISH_CONTROLS = {
  collections: {
    'personal-projects': 'public',
    projects: 'public',
    highlights: 'public',
    profile: 'public',
    resume: 'public',
    blogs: 'public',
    notifications: 'public',
  },
};

export function defaultDataForCollection(key) {
  if (key === 'publish-controls') return structuredClone(DEFAULT_PUBLISH_CONTROLS);
  return null;
}

export function listAdminCollections() {
  return EDITABLE_COLLECTIONS.map(({ key, label, multiFile }) => ({
    key,
    label,
    multiFile: multiFile === true,
  }));
}

export function getAdminCollectionByKey(key) {
  return byKey.get(String(key || '').trim()) || null;
}
