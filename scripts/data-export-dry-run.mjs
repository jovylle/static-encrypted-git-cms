// Dry run: prints what `data:export` would export. Writes nothing. Uses the same publish-controls gate and key
// check as the real export (export-gate.mjs), so a missing or undecryptable publish-controls.json.enc is an
// error here too (exit 1, or exit 0 with ALLOW_PARTIAL_EXPORT=1), and every collection shows as skipped.

import fs from 'fs';
import path from 'path';
import process from 'process';
import { decryptJson } from './lib/content-crypto.mjs';
import {
  ENCRYPTED_DIR,
  ROOT_FILES,
  SKIP_FILES,
  allEncryptedPaths,
  encryptedToSourceRel,
} from './lib/data-paths.mjs';
import { loadDotEnv } from './lib/data-io.mjs';
import { isPartialAllowed } from './lib/decrypt-report.mjs';
import { checkContentKey, loadPublishControls } from './lib/export-gate.mjs';
import { CONTROLS_UNAVAILABLE_WARNING } from './lib/export-public.mjs';
import {
  filterListCollection,
  isPublicBlogPost,
  isPublicItem,
} from './lib/public-filter.mjs';
import { ALWAYS_PUBLIC_ROOT_FILES, shouldExportCollection } from './lib/publish-controls.mjs';

loadDotEnv();

const keyError = checkContentKey();
if (keyError) {
  console.error(keyError);
  process.exit(1);
}

function decryptEncryptedRel(encRel) {
  const fullEnc = path.join(ENCRYPTED_DIR, encRel);
  if (!fs.existsSync(fullEnc) || fs.statSync(fullEnc).size === 0) {
    return { ok: false, reason: 'missing or empty encrypted file' };
  }
  try {
    const wrapperText = fs.readFileSync(fullEnc, 'utf8');
    const plain = decryptJson(wrapperText);
    return { ok: true, data: JSON.parse(plain) };
  } catch (e) {
    return { ok: false, reason: `decrypt failed: ${e.message}` };
  }
}

const { controls: publishControls, failure: controlsFailure } = loadPublishControls();
const controlsBlocked = (collectionId) =>
  controlsFailure !== null || !shouldExportCollection(publishControls, collectionId);
const isAlwaysPublic = (filename) => ALWAYS_PUBLIC_ROOT_FILES.includes(filename);
const controlsSkipReason = controlsFailure
  ? 'publish-controls.json.enc unavailable'
  : 'publish-controls status is not public';

function countPublicItems(data, listKey) {
  if (!data || !Array.isArray(data[listKey])) return 0;
  return data[listKey].filter(isPublicItem).length;
}

function logAction(action, target, detail = '') {
  const prefix = action === 'export' ? '✓ export' : '✗ skip';
  const suffix = detail ? ` — ${detail}` : '';
  console.log(`${prefix}  ${target}${suffix}`);
}

if (!fs.existsSync(ENCRYPTED_DIR)) {
  console.error('data/encrypted/ not found. Run: npm run data:encrypt');
  process.exit(1);
}

const encPaths = allEncryptedPaths();
if (encPaths.length === 0) {
  console.error('No encrypted content. Run: npm run data:encrypt');
  process.exit(1);
}

console.log('Export dry-run (no files written)\n');
console.log('Publish controls:');
if (controlsFailure) {
  console.error(`[error] ${controlsFailure.file}: ${controlsFailure.message}`);
  console.error(CONTROLS_UNAVAILABLE_WARNING);
}
for (const [collectionId, status] of Object.entries(publishControls?.collections || {})) {
  console.log(`  ${collectionId}: ${status}`);
}
console.log('');

let exportCount = 0;
let skipCount = 0;

for (const filename of ROOT_FILES) {
  if (SKIP_FILES.has(filename)) continue;
  if (filename === 'publish-controls.json') {
    logAction('skip', filename, 'internal only');
    skipCount += 1;
    continue;
  }

  const collectionId = filename.replace(/\.json$/, '');
  if (!isAlwaysPublic(filename) && controlsBlocked(collectionId)) {
    logAction('skip', filename, controlsSkipReason);
    skipCount += 1;
    continue;
  }

  const encRel = filename.replace(/\.json$/, '.json.enc');
  const result = decryptEncryptedRel(encRel);
  if (!result.ok) {
    logAction('skip', filename, result.reason);
    skipCount += 1;
    continue;
  }

  let detail = '';
  if (filename === 'projects.json') {
    const total = result.data?.projects?.length ?? 0;
    const publicCount = countPublicItems(result.data, 'projects');
    detail = `${publicCount}/${total} public projects`;
  } else if (filename === 'personal-projects.json') {
    const total = result.data?.projects?.length ?? 0;
    const publicCount = countPublicItems(result.data, 'projects');
    detail = `${publicCount}/${total} public projects (sorted by priority_score)`;
  }

  logAction('export', `public/data/${filename}`, detail);
  exportCount += 1;
}

if (controlsBlocked('blogs')) {
  logAction('skip', 'public/data/blogs/*', controlsSkipReason);
  skipCount += 1;
} else {
  const encBlogsDir = path.join(ENCRYPTED_DIR, 'blogs');
  if (!fs.existsSync(encBlogsDir)) {
    logAction('skip', 'public/data/blogs/*', 'no encrypted blogs directory');
    skipCount += 1;
  } else {
    const files = fs.readdirSync(encBlogsDir).filter((f) => f.endsWith('.json.enc'));
    let blogExport = 0;
    let blogSkip = 0;
    for (const encFile of files) {
      const encRel = `blogs/${encFile}`;
      const result = decryptEncryptedRel(encRel);
      const outName = encryptedToSourceRel(encFile);
      if (!result.ok) {
        logAction('skip', `public/data/blogs/${outName}`, result.reason);
        blogSkip += 1;
        continue;
      }
      if (!isPublicBlogPost(result.data)) {
        logAction('skip', `public/data/blogs/${outName}`, 'draft or private');
        blogSkip += 1;
        continue;
      }
      logAction('export', `public/data/blogs/${outName}`);
      blogExport += 1;
    }
    exportCount += blogExport;
    skipCount += blogSkip;
    if (blogExport > 0) {
      logAction('export', 'public/data/blogs/index.json', 'generated at build time');
      exportCount += 1;
    }
  }
}

console.log(`\nSummary: ${exportCount} would export, ${skipCount} would skip`);

if (controlsFailure) {
  if (isPartialAllowed()) {
    console.warn('ALLOW_PARTIAL_EXPORT=1 is set: dry run exits 0 with every collection skipped.');
  } else {
    process.exitCode = 1;
  }
}
