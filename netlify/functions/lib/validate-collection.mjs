import fs from 'fs/promises';
import path from 'path';

function repoRoot() {
  return process.cwd();
}

const SCHEMAS_DIR = () => path.join(repoRoot(), 'schemas');
const MANIFEST_PATH = () => path.join(SCHEMAS_DIR(), 'manifest.collections.json');

let ajvReady = null;

async function getAjv() {
  if (!ajvReady) {
    const Ajv2020 = (await import('ajv/dist/2020.js')).default;
    const addFormats = (await import('ajv-formats')).default;
    const ajv = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true });
    addFormats(ajv);
    ajvReady = ajv;
  }
  return ajvReady;
}

async function loadJson(filePath) {
  const fileContent = await fs.readFile(filePath, 'utf8');
  return JSON.parse(fileContent);
}

export async function loadManifest() {
  const raw = await fs.readFile(MANIFEST_PATH(), 'utf8');
  return JSON.parse(raw);
}

/**
 * Validate in-memory collection data against its manifest schema (Netlify-safe paths).
 * @param {string} collectionId
 * @param {unknown} data
 * @param {{ collections?: Array<{ id: string, schema: string }> }} [manifest]
 * @returns {Promise<{ ok: boolean, errors: string[] }>}
 */
export async function validateCollectionData(collectionId, data, manifest = null) {
  const m = manifest || (await loadManifest());
  const col = (m.collections || []).find((item) => item.id === collectionId);
  if (!col) return { ok: true, errors: [] };

  const schemaPath = path.join(SCHEMAS_DIR(), col.schema);
  try {
    await fs.access(schemaPath);
  } catch {
    return { ok: false, errors: [`ERROR ${collectionId}: schema not found (${col.schema})`] };
  }

  try {
    const ajv = await getAjv();
    const schema = await loadJson(schemaPath);
    const validate = ajv.compile(schema);
    if (validate(data)) return { ok: true, errors: [] };

    const errors = [`FAIL ${collectionId}: schema validation`];
    for (const err of validate.errors || []) {
      const at = err.instancePath || '/';
      errors.push(`  - ${at} ${err.message || 'validation error'}`);
    }
    return { ok: false, errors };
  } catch (e) {
    return { ok: false, errors: [`ERROR ${collectionId}: ${e?.message || e}`] };
  }
}
