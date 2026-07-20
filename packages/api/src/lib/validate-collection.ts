import type { Env } from '../helpers';

interface SchemaCollection {
  id: string;
  source: string;
  schema: string;
  export?: { publicPath: string; filter: string };
}

interface Manifest {
  version: number;
  collections: SchemaCollection[];
}

let cachedManifest: Manifest | null = null;
let cachedAjv: any = null;
const schemaCache = new Map<string, any>();

function getManifest(): Manifest {
  if (!cachedManifest) {
    cachedManifest = {
      "version": 1,
      "collections": [
        { "id": "personal-projects", "source": "personal-projects.json", "schema": "personal-projects.schema.json", "export": { "publicPath": "personal-projects.json", "filter": "sort-priority-projects" } },
        { "id": "projects", "source": "projects.json", "schema": "projects.schema.json", "export": { "publicPath": "projects.json", "filter": "list-public" } },
        { "id": "highlights", "source": "highlights.json", "schema": "highlights.schema.json", "export": { "publicPath": "highlights.json", "filter": "none" } },
        { "id": "publish-controls", "source": "publish-controls.json", "schema": "publish-controls.schema.json", "export": { "publicPath": "publish-controls.json", "filter": "none" } },
        { "id": "profile", "source": "profile.json", "schema": "profile.schema.json", "export": { "publicPath": "profile.json", "filter": "none" } },
        { "id": "resume", "source": "resume.json", "schema": "resume.schema.json", "export": { "publicPath": "resume.json", "filter": "none" } },
        { "id": "notification-bundle", "source": "notifications/*.json", "schema": "notification-bundle.schema.json", "export": { "publicPath": "notifications/{basename}.json", "filter": "notification-bundle" } },
        { "id": "blog-post", "source": "blogs/*.json", "schema": "blog-post.schema.json", "export": { "publicPath": "blogs/{slug}.json", "filter": "blog-public" } },
        { "id": "homepage", "source": "homepage.json", "schema": "homepage.schema.json", "export": { "publicPath": "homepage.json", "filter": "none" } },
        { "id": "social", "source": "social.json", "schema": "social.schema.json", "export": { "publicPath": "social.json", "filter": "none" } },
        { "id": "uses", "source": "uses.json", "schema": "uses.schema.json", "export": { "publicPath": "uses.json", "filter": "none" } }
      ]
    };
  }
  return cachedManifest;
}

async function getAjv(): Promise<any> {
  if (!cachedAjv) {
    const Ajv2020 = (await import('ajv/dist/2020.js')).default;
    const addFormats = (await import('ajv-formats')).default;
    const ajv = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true });
    addFormats(ajv);
    cachedAjv = ajv;
  }
  return cachedAjv;
}

export async function validateCollectionData(
  collectionId: string,
  data: any,
  manifest: Manifest | null = null,
): Promise<{ ok: boolean; errors: string[] }> {
  const m = manifest || getManifest();
  const col = (m.collections || []).find((item) => item.id === collectionId);
  if (!col) return { ok: true, errors: [] };

  try {
    const ajv = await getAjv();
    const schema = await getSchema(col.schema);
    const validate = ajv.compile(schema);
    if (validate(data)) return { ok: true, errors: [] };

    const errors = [`FAIL ${collectionId}: schema validation`];
    for (const err of validate.errors || []) {
      const at = err.instancePath || '/';
      errors.push(`  - ${at} ${err.message || 'validation error'}`);
    }
    return { ok: false, errors };
  } catch (e: any) {
    return { ok: false, errors: [`ERROR ${collectionId}: ${e?.message || e}`] };
  }
}

async function getSchema(schemaName: string): Promise<any> {
  if (schemaCache.has(schemaName)) return schemaCache.get(schemaName);

  let schema: any;
  if (schemaName === 'personal-projects.schema.json') schema = await fetchFromSchemas('personal-projects');
  else if (schemaName === 'projects.schema.json') schema = await fetchFromSchemas('projects');
  else if (schemaName === 'blog-post.schema.json') schema = await fetchFromSchemas('blog-post');
  else if (schemaName === 'notification-bundle.schema.json') schema = await fetchFromSchemas('notification-bundle');
  else if (schemaName === 'publish-controls.schema.json') schema = await fetchFromSchemas('publish-controls');
  else if (schemaName === 'highlights.schema.json') schema = await fetchFromSchemas('highlights');
  else if (schemaName === 'profile.schema.json') schema = await fetchFromSchemas('profile');
  else if (schemaName === 'resume.schema.json') schema = await fetchFromSchemas('resume');
  else if (schemaName === 'homepage.schema.json') schema = await fetchFromSchemas('homepage');
  else if (schemaName === 'social.schema.json') schema = await fetchFromSchemas('social');
  else if (schemaName === 'uses.schema.json') schema = await fetchFromSchemas('uses');
  else throw new Error(`Unknown schema: ${schemaName}`);

  schemaCache.set(schemaName, schema);
  return schema;
}

function fetchFromSchemas(name: string): any {
  const schemas: Record<string, any> = {
    "personal-projects": {"type":"object","additionalProperties":false,"required":["title","description","repo","updated_at","slug","status","private","fav","priority_score","tech","links"],"properties":{"title":{"type":"string"},"description":{"type":"string"},"repo":{"type":"string","format":"uri"},"updated_at":{"type":"string","format":"date-time"},"slug":{"type":"string","pattern":"^[a-z0-9]+(?:-[a-z0-9]+)*$"},"status":{"type":"string","enum":["draft","published","private"]},"private":{"type":"boolean"},"fav":{"type":"boolean"},"priority_score":{"type":"integer","minimum":0,"maximum":1000},"tech":{"type":"array","items":{"type":"string"}},"links":{"type":"array","items":{"type":"object","properties":{"label":{"type":"string"},"url":{"type":"string","format":"uri"}},"required":["label","url"]}},"thumbnail":{"type":"string"},"language":{"type":"string"}}},
    "projects": {"type":"object","additionalProperties":true,"properties":{"title":{"type":"string"},"status":{"type":"string","enum":["draft","published","private"]},"private":{"type":"boolean"},"slug":{"type":"string"}}},
    "blog-post": {"type":"object","additionalProperties":true,"required":["slug"],"properties":{"slug":{"type":"string","pattern":"^[a-z0-9]+(?:-[a-z0-9]+)*$"},"title":{"type":"string"},"excerpt":{"type":"string"},"author":{"type":"string"},"date":{"type":"string"},"status":{"type":"string","enum":["draft","published"]},"private":{"type":"boolean"},"featured":{"type":"boolean"},"tags":{"type":"array","items":{"type":"string"}},"thumbnail":{"type":"string"},"content":{"type":"string"},"body":{"type":"string"}}},
    "notification-bundle": {"type":"object","properties":{"notifications":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string"},"title":{"type":"string"},"message":{"type":"string"},"type":{"type":"string","enum":["info","success","warning","error","announcement"]},"tags":{"type":"array","items":{"type":"string"}},"timestamp":{"type":"string"},"persistent":{"type":"boolean"},"status":{"type":"string","enum":["draft","published"]},"private":{"type":"boolean"},"date":{"type":"string"},"expiresAt":{"type":"string"},"link":{"type":"string"}}}}}},
    "publish-controls": {"type":"object","properties":{"collections":{"type":"object"},"personal_projects_public":{"type":"boolean"}}},
    "highlights": {"type":"object"},
    "profile": {"type":"object"},
    "resume": {"type":"object"},
    "homepage": {"type":"object"},
    "social": {"type":"object"},
    "uses": {"type":"object"},
  };
  return schemas[name] || null;
}

export function loadManifest(): Manifest {
  return getManifest();
}
