import fs from 'fs/promises';
import path from 'path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { ROOT, SOURCE_DIR } from './data-paths.mjs';

const ajv = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true });
addFormats(ajv);

const MANIFEST_PATH = path.join(ROOT, 'schemas', 'manifest.collections.json');
const SCHEMAS_DIR = path.join(ROOT, 'schemas');

export async function loadManifest() {
  const raw = await fs.readFile(MANIFEST_PATH, 'utf8');
  return JSON.parse(raw);
}

async function loadJson(filePath) {
  const fileContent = await fs.readFile(filePath, 'utf8');
  return JSON.parse(fileContent);
}

/**
 * @param {{ collections?: Array<{ id: string, source: string, schema: string }> }} [manifest]
 * @returns {Promise<{ ok: boolean, errors: string[] }>}
 */
export async function validateSourceData(manifest = null) {
  const m = manifest || (await loadManifest());
  const errors = [];

  for (const col of m.collections || []) {
    const dataPath = path.join(SOURCE_DIR, col.source);
    const schemaPath = path.join(SCHEMAS_DIR, col.schema);

    try {
      await fs.access(dataPath);
      await fs.access(schemaPath);
    } catch {
      errors.push(`SKIP ${col.id}: missing ${col.source} or schema`);
      continue;
    }

    try {
      const [data, schema] = await Promise.all([loadJson(dataPath), loadJson(schemaPath)]);
      const validate = ajv.compile(schema);
      if (!validate(data)) {
        errors.push(`FAIL ${col.id}: ${col.source}`);
        for (const err of validate.errors || []) {
          const at = err.instancePath || '/';
          errors.push(`  - ${at} ${err.message || 'validation error'}`);
        }
      }
    } catch (e) {
      errors.push(`ERROR ${col.id}: ${e?.message || e}`);
    }
  }

  const ok = !errors.some((line) => line.startsWith('FAIL') || line.startsWith('ERROR'));
  return { ok, errors };
}

/**
 * Validate in-memory collection data against its manifest schema.
 * @param {string} collectionId
 * @param {unknown} data
 * @param {{ collections?: Array<{ id: string, schema: string }> }} [manifest]
 * @returns {Promise<{ ok: boolean, errors: string[] }>}
 */
export async function validateCollectionData(collectionId, data, manifest = null) {
  const m = manifest || (await loadManifest());
  const col = (m.collections || []).find((item) => item.id === collectionId);
  if (!col) return { ok: true, errors: [] };

  const schemaPath = path.join(SCHEMAS_DIR, col.schema);
  try {
    await fs.access(schemaPath);
  } catch {
    return { ok: false, errors: [`ERROR ${collectionId}: schema not found (${col.schema})`] };
  }

  try {
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
