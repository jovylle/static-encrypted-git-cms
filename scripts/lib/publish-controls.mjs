// Publish controls: which collections the static export may publish.
//
// Shape (schemas/publish-controls.schema.json, strict): { collections: { <all 10 ids>: 'public'|'draft'|'private' } }.
// Legacy top-level boolean `personal_projects_public` is still accepted (optional).
//
// Rules (most restrictive wins):
// - A collection's status comes from collections[id]. Only an enum value counts; the schema rejects anything else.
// - personal_projects_public: false forces personal-projects to 'private' even when collections says 'public'.
//   personal_projects_public: true does NOT make personal-projects public on its own; collections still applies.
// - Every collection is 'public' only when no rule restricts it. Callers never use this module with a missing or
//   invalid controls object: export-gate.mjs validates first and reports a failure (fail closed).

import fs from 'fs';
import path from 'path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { ROOT } from './data-paths.mjs';

export const COLLECTION_STATUS_VALUES = new Set(['public', 'draft', 'private']);

// Restrictiveness order: a lower rank is more restrictive.
const RESTRICTIVENESS = { private: 0, draft: 1, public: 2 };

export const COLLECTION_IDS = Object.freeze([
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
]);

// fast-scores.json is in ROOT_FILES but is intentionally NOT gated: it is always public (leaderboard scores), even
// when publish-controls is unavailable. It has no entry in publish-controls, so it cannot be restricted.
// The export and the dry run both read this list. Keep it in sync with the README and docs/DATA-ENCRYPTION.md.
export const ALWAYS_PUBLIC_ROOT_FILES = Object.freeze(['fast-scores.json']);

const SCHEMA_PATH = path.join(ROOT, 'schemas', 'publish-controls.schema.json');

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
let compiledValidator = null;

function getValidator() {
  if (!compiledValidator) {
    const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
    compiledValidator = ajv.compile(schema);
  }
  return compiledValidator;
}

/**
 * Strict schema check of a decrypted publish-controls object. Messages name the key path and the rule that failed,
 * never the value that was found.
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validatePublishControlsShape(data) {
  const validate = getValidator();
  if (validate(data)) return { ok: true, errors: [] };

  const errors = [];
  for (const err of validate.errors || []) {
    const at = err.instancePath || '/';
    if (err.keyword === 'required') {
      errors.push(`${at}: missing required key "${err.params.missingProperty}"`);
    } else if (err.keyword === 'additionalProperties') {
      errors.push(`${at}: unrecognized key "${err.params.additionalProperty}"`);
    } else if (err.keyword === 'enum') {
      errors.push(`${at}: must be one of public, draft, private`);
    } else {
      errors.push(`${at}: ${err.message || 'schema violation'}`);
    }
  }
  return { ok: false, errors: [...new Set(errors)] };
}

function mostRestrictive(a, b) {
  return RESTRICTIVENESS[a] <= RESTRICTIVENESS[b] ? a : b;
}

const DEFAULT_COLLECTIONS = Object.freeze(
  COLLECTION_IDS.reduce((acc, id) => {
    acc[id] = 'public';
    return acc;
  }, {}),
);

export function normalizePublishControls(data) {
  const collections = { ...DEFAULT_COLLECTIONS };

  if (data && typeof data === 'object') {
    if (data.collections && typeof data.collections === 'object') {
      for (const id of COLLECTION_IDS) {
        const value = data.collections[id];
        if (COLLECTION_STATUS_VALUES.has(value)) {
          collections[id] = value;
        }
      }
    }
    if (typeof data.personal_projects_public === 'boolean') {
      const legacy = data.personal_projects_public ? 'public' : 'private';
      collections['personal-projects'] = mostRestrictive(collections['personal-projects'], legacy);
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
