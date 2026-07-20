interface AdminCollection {
  key: string;
  label: string;
  multiFile?: boolean;
  filePath?: string;
  dirPath?: string;
}

const EDITABLE_COLLECTIONS: AdminCollection[] = [
  { key: 'personal-projects', label: 'Personal Projects', filePath: 'data/encrypted/personal-projects.json.enc' },
  { key: 'projects', label: 'Projects', filePath: 'data/encrypted/projects.json.enc' },
  { key: 'highlights', label: 'Highlights', filePath: 'data/encrypted/highlights.json.enc' },
  { key: 'profile', label: 'Profile', filePath: 'data/encrypted/profile.json.enc' },
  { key: 'resume', label: 'Resume', filePath: 'data/encrypted/resume.json.enc' },
  { key: 'notifications', label: 'Notifications', multiFile: true, dirPath: 'data/encrypted/notifications' },
  { key: 'publish-controls', label: 'Publish Controls', filePath: 'data/encrypted/publish-controls.json.enc' },
  { key: 'blogs', label: 'Blog posts', multiFile: true, dirPath: 'data/encrypted/blogs' },
];

const byKey = new Map(EDITABLE_COLLECTIONS.map((item) => [item.key, item]));

export const DEFAULT_PUBLISH_CONTROLS = {
  collections: {
    'personal-projects': 'public' as const,
    projects: 'public' as const,
    highlights: 'public' as const,
    profile: 'public' as const,
    resume: 'public' as const,
    blogs: 'public' as const,
    notifications: 'public' as const,
  },
};

export function defaultDataForCollection(key: string): any {
  if (key === 'publish-controls') return structuredClone(DEFAULT_PUBLISH_CONTROLS);
  return null;
}

export function listAdminCollections(): { key: string; label: string; multiFile: boolean }[] {
  return EDITABLE_COLLECTIONS.map(({ key, label, multiFile }) => ({
    key,
    label,
    multiFile: multiFile === true,
  }));
}

export function getAdminCollectionByKey(key: string): AdminCollection | null {
  return byKey.get(String(key || '').trim()) || null;
}
