// Build-time export core: decrypts data/encrypted/**, applies public filters, and writes public/data/ and
// public/notifications/. scripts/data-export.mjs is the CLI wrapper; tests call exportPublicData() with temp
// directories and a throwaway key. Directories are arguments so no test ever touches real data/.
//
// Gotchas:
// - Output dirs are wiped first (except .gitkeep and usage-metrics.json, which GitHub Actions writes). A
//   collection whose files all fail is ABSENT afterwards, not empty. notifications.json is still written as
//   an empty list when the notifications directory exists but every bundle fails.
// - Fail closed: a decrypt or parse failure is recorded and the run exits 1 after listing every failing file.
//   ALLOW_PARTIAL_EXPORT=1 (allowPartial) turns failures into warnings and exit 0. A missing or empty .enc
//   that is NOT publish-controls is only a warning and is skipped.
// - publish-controls.json.enc is a hard gate (export-gate.mjs). If it is missing, empty, undecryptable or
//   unparseable, it is a FAILURE. Every collection is then treated as NOT public, with or without
//   ALLOW_PARTIAL_EXPORT. Only the collections whose gate is open are exported.
// - A missing or unusable CONTENT_DECRYPT_KEY fails fast with one message, before anything is wiped.
// - Public filtering lives in public-filter.mjs. The Worker's live routes apply the same item and blog rules
//   (packages/api/src/lib/public-visibility.ts); tests/fixtures/visibility-cases.json keeps them aligned.

import fs from 'fs';
import path from 'path';
import { decryptJson } from './content-crypto.mjs';
import {
  ENCRYPTED_DIR,
  PUBLIC_DATA_DIR,
  PUBLIC_NOTIFICATIONS_DIR,
  ROOT_FILES,
  SKIP_FILES,
  encryptedToSourceRel,
} from './data-paths.mjs';
import { ensureDir, writeJsonFile } from './data-io.mjs';
import {
  filterListCollection,
  isPublicBlogPost,
  sortPersonalProjects,
  filterNotificationBundle,
  flattenNotificationsForCms,
} from './public-filter.mjs';
import { transformAssetUrls } from './asset-urls.mjs';
import { normalizePersonalProjectsFile } from './personal-project-normalize.mjs';
import { ALWAYS_PUBLIC_ROOT_FILES, shouldExportCollection } from './publish-controls.mjs';
import { checkContentKey, loadPublishControls } from './export-gate.mjs';
import { summarizeDecryptFailures } from './decrypt-report.mjs';

export const CONTROLS_UNAVAILABLE_WARNING =
  'WARNING: publish-controls.json.enc is unavailable, so EVERY collection is treated as NOT public. ' +
  'Nothing gated by publish controls was exported.';

/**
 * @returns {{ exitCode: number, lines: string[], exported: string[] }}
 *   exitCode 1 for any failure (unless allowPartial and the failure is a decrypt/parse failure, see
 *   summarizeDecryptFailures). lines are the report to print. exported lists every file written.
 */
export function exportPublicData({
  encryptedDir = ENCRYPTED_DIR,
  publicDataDir = PUBLIC_DATA_DIR,
  publicNotificationsDir = PUBLIC_NOTIFICATIONS_DIR,
  allowPartial = false,
} = {}) {
  if (!fs.existsSync(encryptedDir)) {
    return {
      exitCode: 1,
      lines: ['data/encrypted/ not found. Run: npm run data:encrypt'],
      exported: [],
    };
  }

  const keyError = checkContentKey();
  if (keyError) {
    return { exitCode: 1, lines: [keyError], exported: [] };
  }

  const decryptFailures = [];
  const exported = [];

  function decryptEncryptedRel(encRel) {
    const fullEnc = path.join(encryptedDir, encRel);
    if (!fs.existsSync(fullEnc) || fs.statSync(fullEnc).size === 0) {
      console.warn(`[warn] Missing or empty encrypted file: ${encRel}`);
      return null;
    }
    try {
      return JSON.parse(decryptJson(fs.readFileSync(fullEnc, 'utf8')));
    } catch (e) {
      console.warn(`[warn] Failed to decrypt ${encRel}: ${e.message}`);
      decryptFailures.push({ file: encRel, message: e.message });
      return null;
    }
  }

  const { controls, failure: controlsFailure } = loadPublishControls({ encryptedDir });
  if (controlsFailure) {
    console.warn(`[warn] ${controlsFailure.file}: ${controlsFailure.message}`);
    decryptFailures.push(controlsFailure);
  }

  /** A collection is exported only when the controls file is valid and the collection status is public. */
  const gateOpen = (collectionId) =>
    !controlsFailure && shouldExportCollection(controls, collectionId);

  function skipNote(label) {
    const why = controlsFailure ? 'publish controls unavailable' : 'publish-controls status is not public';
    console.log(`Skipping export of ${label} (${why}).`);
  }

  function emit(outPath, payload) {
    writeJsonFile(outPath, payload);
    exported.push(outPath);
  }

  function exportRootFile(filename) {
    if (SKIP_FILES.has(filename)) return;
    if (filename === 'publish-controls.json') return;

    const collectionId = filename.replace(/\.json$/, '');
    if (!ALWAYS_PUBLIC_ROOT_FILES.includes(filename) && !gateOpen(collectionId)) {
      skipNote(filename);
      return;
    }

    const data = decryptEncryptedRel(filename.replace(/\.json$/, '.json.enc'));
    if (data === null) return;

    const outPath = path.join(publicDataDir, filename);

    if (filename === 'projects.json') {
      emit(outPath, transformAssetUrls(filterListCollection(data, 'projects')));
      return;
    }
    if (filename === 'personal-projects.json') {
      const normalized = normalizePersonalProjectsFile(data);
      emit(
        outPath,
        transformAssetUrls(sortPersonalProjects(filterListCollection(normalized, 'projects'))),
      );
      return;
    }

    // highlights, profile, resume, and the rest: full export
    emit(outPath, transformAssetUrls(data));
  }

  function exportNotifications() {
    if (!gateOpen('notifications')) {
      skipNote('notifications');
      return;
    }

    const encDir = path.join(encryptedDir, 'notifications');
    if (!fs.existsSync(encDir)) return;

    ensureDir(publicNotificationsDir);
    const files = fs.readdirSync(encDir).filter((f) => f.endsWith('.json.enc'));
    const rawBundles = [];

    for (const encFile of files) {
      const data = decryptEncryptedRel(`notifications/${encFile}`);
      if (data === null) continue;
      rawBundles.push(data);
      const filtered = filterNotificationBundle(data);
      if (filtered.notifications.length === 0) continue;
      const outName = encryptedToSourceRel(encFile);
      emit(path.join(publicNotificationsDir, outName), transformAssetUrls(filtered));
    }

    emit(path.join(publicDataDir, 'notifications.json'), transformAssetUrls(flattenNotificationsForCms(rawBundles)));
  }

  function exportBlogs() {
    if (!gateOpen('blogs')) {
      skipNote('blogs collection');
      return;
    }

    const encBlogsDir = path.join(encryptedDir, 'blogs');
    const outBlogsDir = path.join(publicDataDir, 'blogs');
    if (!fs.existsSync(encBlogsDir)) return;

    ensureDir(outBlogsDir);
    const files = fs.readdirSync(encBlogsDir).filter((f) => f.endsWith('.json.enc'));

    for (const encFile of files) {
      const data = decryptEncryptedRel(`blogs/${encFile}`);
      if (data === null) continue;
      if (!isPublicBlogPost(data)) continue;
      emit(path.join(outBlogsDir, encryptedToSourceRel(encFile)), transformAssetUrls(data));
    }
  }

  // Clear generated public data (keep .gitkeep + usage-metrics from GitHub Actions)
  let preservedUsageMetrics = null;
  const usageMetricsPath = path.join(publicDataDir, 'usage-metrics.json');
  if (fs.existsSync(usageMetricsPath)) {
    preservedUsageMetrics = fs.readFileSync(usageMetricsPath, 'utf8');
  }
  if (fs.existsSync(publicDataDir)) {
    for (const entry of fs.readdirSync(publicDataDir)) {
      if (entry === '.gitkeep') continue;
      fs.rmSync(path.join(publicDataDir, entry), { recursive: true, force: true });
    }
  }
  ensureDir(publicDataDir);
  if (fs.existsSync(publicNotificationsDir)) {
    fs.rmSync(publicNotificationsDir, { recursive: true, force: true });
  }
  ensureDir(publicNotificationsDir);
  if (preservedUsageMetrics) {
    fs.writeFileSync(usageMetricsPath, preservedUsageMetrics);
  }

  for (const filename of ROOT_FILES) {
    exportRootFile(filename);
  }
  exportNotifications();
  exportBlogs();

  const report = summarizeDecryptFailures(decryptFailures, { action: 'export', allowPartial });
  const lines = [...report.lines];
  if (controlsFailure) lines.push(CONTROLS_UNAVAILABLE_WARNING);
  return { exitCode: report.exitCode, lines, exported };
}
