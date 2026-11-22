export const PROJECT_STATUS_VALUES = new Set(['published', 'draft', 'private']);
export const COLLECTION_STATUS_VALUES = new Set(['public', 'draft', 'private']);
export const MANAGED_COLLECTION_IDS = new Set([
  'personal-projects',
  'projects',
  'highlights',
  'profile',
  'resume',
  'blogs',
  'notifications',
]);

interface PersonalProjectsData {
  projects: Array<{
    slug: string;
    status: string;
    private: boolean;
    [key: string]: any;
  }>;
  [key: string]: any;
}

interface ProjectVisibilityUpdate {
  slug: string;
  status?: string;
  private?: boolean;
}

export function applyProjectVisibilityUpdate(
  data: PersonalProjectsData,
  update: ProjectVisibilityUpdate,
): { slug: string; status: string; private: boolean } {
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

interface PublishControls {
  collections: Record<string, string>;
  personal_projects_public?: boolean;
}

// Every collection the export reads from publish-controls.json. Must match COLLECTION_IDS in
// scripts/lib/publish-controls.mjs and the schema's required list. Dropping one on write-back loses its status.
export const CONTROL_COLLECTION_IDS = [
  'personal-projects',
  'projects',
  'highlights',
  'profile',
  'resume',
  'blogs',
  'notifications',
  'homepage',
  'social',
  'uses',
];

export function normalizePublishControls(data: any): PublishControls {
  const collections: Record<string, string> = {};
  for (const id of CONTROL_COLLECTION_IDS) collections[id] = 'public';

  if (data && typeof data === 'object') {
    if (data.collections && typeof data.collections === 'object') {
      for (const key of CONTROL_COLLECTION_IDS) {
        const value = data.collections[key];
        if (COLLECTION_STATUS_VALUES.has(value)) {
          collections[key] = value;
        }
      }
    }
    // Most restrictive wins, same as scripts/lib/publish-controls.mjs: legacy false forces private.
    if (data.personal_projects_public === false) {
      collections['personal-projects'] = 'private';
    }
  }

  return { collections };
}

interface CollectionVisibilityUpdate {
  personal_projects_public?: boolean;
  collection?: string;
  status?: string;
}

export function applyCollectionVisibilityUpdate(
  data: any,
  update: CollectionVisibilityUpdate,
): PublishControls {
  const controls = normalizePublishControls(data);

  if (typeof update.personal_projects_public === 'boolean') {
    controls.collections['personal-projects'] = update.personal_projects_public
      ? 'public'
      : 'private';
    return controls;
  }

  const collection = String(update.collection || '').trim();
  const status = String(update.status || '').trim();

  if (!MANAGED_COLLECTION_IDS.has(collection)) {
    throw new Error(
      'collection must be one of personal-projects, projects, highlights, profile, resume, blogs, notifications',
    );
  }
  if (!COLLECTION_STATUS_VALUES.has(status)) {
    throw new Error('status must be "public", "draft", or "private"');
  }

  controls.collections[collection] = status;
  return controls;
}
