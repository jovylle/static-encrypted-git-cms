import fs from 'fs';
import path from 'path';
import { decryptJson } from './lib/content-crypto.mjs';
import {
  ENCRYPTED_DIR,
  PUBLIC_DATA_DIR,
  ROOT_FILES,
  SKIP_FILES,
  allEncryptedPaths,
  encryptedToSourceRel,
} from './lib/data-paths.mjs';
import { loadDotEnv, ensureDir, writeJsonFile } from './lib/data-io.mjs';
import {
  filterListCollection,
  isPublicBlogPost,
  sortPersonalProjects,
} from './lib/public-filter.mjs';
import { transformAssetUrls } from './lib/asset-urls.mjs';
import { normalizePersonalProjectsFile } from './lib/personal-project-normalize.mjs';
import {
  normalizePublishControls,
  shouldExportCollection,
} from './lib/publish-controls.mjs';

loadDotEnv();

function decryptEncryptedRel(encRel) {
  const fullEnc = path.join(ENCRYPTED_DIR, encRel);
  if (!fs.existsSync(fullEnc) || fs.statSync(fullEnc).size === 0) {
    console.warn(`[warn] Missing or empty encrypted file: ${encRel}`);
    return null;
  }
  try {
    const wrapperText = fs.readFileSync(fullEnc, 'utf8');
    const plain = decryptJson(wrapperText);
    return JSON.parse(plain);
  } catch (e) {
    console.warn(`[warn] Failed to decrypt ${encRel}: ${e.message}`);
    return null;
  }
}

function loadPublishControls() {
  const encRel = 'publish-controls.json.enc';
  const fullEnc = path.join(ENCRYPTED_DIR, encRel);
  if (!fs.existsSync(fullEnc) || fs.statSync(fullEnc).size === 0) {
    return normalizePublishControls(null);
  }
  return normalizePublishControls(decryptEncryptedRel(encRel));
}

const publishControls = loadPublishControls();

function exportRootFile(filename) {
  if (SKIP_FILES.has(filename)) return;
  if (filename === 'publish-controls.json') return;

  const collectionId = filename.replace(/\.json$/, '');
  if (!shouldExportCollection(publishControls, collectionId)) {
    console.log(`Skipping export of ${filename} (publish-controls status is not public).`);
    return;
  }

  const encRel = filename.replace(/\.json$/, '.json.enc');
  const data = decryptEncryptedRel(encRel);
  if (data === null) return;

  const outPath = path.join(PUBLIC_DATA_DIR, filename);

  if (filename === 'projects.json') {
    writeJsonFile(
      outPath,
      transformAssetUrls(filterListCollection(data, 'projects')),
    );
    return;
  }
  if (filename === 'personal-projects.json') {
    const normalized = normalizePersonalProjectsFile(data);
    writeJsonFile(
      outPath,
      transformAssetUrls(
        sortPersonalProjects(filterListCollection(normalized, 'projects')),
      ),
    );
    return;
  }
  if (filename === 'notifications.json') {
    writeJsonFile(
      outPath,
      transformAssetUrls(filterListCollection(data, 'notifications')),
    );
    return;
  }

  // highlights, profile, resume — full export
  writeJsonFile(outPath, transformAssetUrls(data));
}

function exportBlogs() {
  if (!shouldExportCollection(publishControls, 'blogs')) {
    console.log('Skipping export of blogs collection (publish-controls status is not public).');
    return;
  }

  const encBlogsDir = path.join(ENCRYPTED_DIR, 'blogs');
  const outBlogsDir = path.join(PUBLIC_DATA_DIR, 'blogs');
  if (!fs.existsSync(encBlogsDir)) return;

  ensureDir(outBlogsDir);
  const files = fs.readdirSync(encBlogsDir).filter((f) => f.endsWith('.json.enc'));

  for (const encFile of files) {
    const encRel = `blogs/${encFile}`;
    const data = decryptEncryptedRel(encRel);
    if (data === null) continue;
    if (!isPublicBlogPost(data)) continue;
    const outName = encryptedToSourceRel(encFile);
    writeJsonFile(path.join(outBlogsDir, outName), transformAssetUrls(data));
  }
}

if (!fs.existsSync(ENCRYPTED_DIR)) {
  console.error('data/encrypted/ not found. Run: npm run data:encrypt');
  process.exit(1);
}

// Clear generated public data (keep .gitkeep + usage-metrics from GitHub Actions)
let preservedUsageMetrics = null;
const usageMetricsPath = path.join(PUBLIC_DATA_DIR, 'usage-metrics.json');
if (fs.existsSync(usageMetricsPath)) {
  preservedUsageMetrics = fs.readFileSync(usageMetricsPath, 'utf8');
}

if (fs.existsSync(PUBLIC_DATA_DIR)) {
  for (const entry of fs.readdirSync(PUBLIC_DATA_DIR)) {
    if (entry === '.gitkeep') continue;
    const p = path.join(PUBLIC_DATA_DIR, entry);
    fs.rmSync(p, { recursive: true, force: true });
  }
}
ensureDir(PUBLIC_DATA_DIR);

if (preservedUsageMetrics) {
  fs.writeFileSync(usageMetricsPath, preservedUsageMetrics);
}

const encPaths = allEncryptedPaths();
if (encPaths.length === 0) {
  console.error('No encrypted content. Run: npm run data:encrypt');
  process.exit(1);
}

for (const filename of ROOT_FILES) {
  exportRootFile(filename);
}

exportBlogs();
console.log('Public data exported to public/data/');
