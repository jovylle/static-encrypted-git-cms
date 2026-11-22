import fs from 'fs/promises';
import path from 'path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { ENCRYPTED_DIR, ROOT, SOURCE_DIR } from './data-paths.mjs';

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

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listDir(dirPath, suffix) {
  try {
    return (await fs.readdir(dirPath)).filter((name) => name.endsWith(suffix));
  } catch {
    return [];
  }
}

/**
 * Validate every manifest collection against its schema.
 *
 * SKIP is reserved for a collection that has neither an encrypted file nor a plaintext source: it is not
 * part of this vault. A collection that HAS an encrypted file but no plaintext source is a FAIL, because the
 * committed data would go unvalidated. (Such a collection shows up when data:decrypt was not run or failed.)
 *
 * @param {{ collections?: Array<{ id: string, source: string, schema: string }> }} [manifest]
 * @param {{ sourceDir?: string, encryptedDir?: string }} [dirs]
 * @returns {Promise<{ ok: boolean, errors: string[] }>}
 */
export async function validateSourceData(
  manifest = null,
  { sourceDir = SOURCE_DIR, encryptedDir = ENCRYPTED_DIR } = {},
) {
  const m = manifest || (await loadManifest());
  const errors = [];
  // Number of source files actually loaded and checked. Zero means nothing was validated, which must fail.
  let checked = 0;

  for (const col of m.collections || []) {
    if (col.source.includes('*')) {
      const dirRel = col.source.split('/')[0];
      let schema;
      try {
        schema = await loadJson(path.join(SCHEMAS_DIR, col.schema));
      } catch {
        errors.push(`SKIP ${col.id}: schema not found (${col.schema})`);
        continue;
      }
      const validate = ajv.compile(schema);
      const files = (await listDir(path.join(sourceDir, dirRel), '.json')).filter(
        (name) => name !== 'index.json' && !name.startsWith('_'),
      );
      // index.json and _* entries are not content collections, so they must not produce a FAIL.
      const encNames = (await listDir(path.join(encryptedDir, dirRel), '.json.enc')).filter(
        (name) => name !== 'index.json.enc' && !name.startsWith('_'),
      );

      for (const encName of encNames) {
        const srcName = encName.replace(/\.json\.enc$/, '.json');
        if (!files.includes(srcName)) {
          errors.push(
            `FAIL ${col.id}: ${dirRel}/${srcName} is encrypted (${dirRel}/${encName}) but has no plaintext in data/source/`,
          );
        }
      }

      if (files.length === 0 && encNames.length === 0) {
        errors.push(`SKIP ${col.id}: no ${dirRel}/ files in data/source/ or data/encrypted/`);
        continue;
      }

      for (const fileName of files) {
        const rel = `${dirRel}/${fileName}`;
        try {
          const data = await loadJson(path.join(sourceDir, rel));
          checked += 1;
          if (!validate(data)) {
            errors.push(`FAIL ${col.id}: ${rel}`);
            for (const err of validate.errors || []) {
              const at = err.instancePath || '/';
              errors.push(`  - ${at} ${err.message || 'validation error'}`);
            }
          }
        } catch (e) {
          errors.push(`ERROR ${col.id}: ${rel} — ${e?.message || e}`);
        }
      }
      continue;
    }

    const dataPath = path.join(sourceDir, col.source);
    const schemaPath = path.join(SCHEMAS_DIR, col.schema);
    const encName = col.source.replace(/\.json$/, '.json.enc');

    if (!(await exists(dataPath))) {
      if (await exists(path.join(encryptedDir, encName))) {
        errors.push(
          `FAIL ${col.id}: ${col.source} is encrypted (${encName}) but has no plaintext in data/source/. Run data:decrypt.`,
        );
      } else {
        errors.push(`SKIP ${col.id}: no ${col.source} and no encrypted file`);
      }
      continue;
    }

    if (!(await exists(schemaPath))) {
      errors.push(`FAIL ${col.id}: schema not found (${col.schema}), so ${col.source} cannot be validated`);
      continue;
    }

    try {
      const [data, schema] = await Promise.all([loadJson(dataPath), loadJson(schemaPath)]);
      checked += 1;
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

  if (checked === 0) {
    errors.push(
      'ERROR no collections found: no manifest source file exists under data/source/. ' +
        'Most likely CONTENT_DECRYPT_KEY is missing or wrong (data:decrypt wrote nothing), or data:decrypt has not run.',
    );
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
