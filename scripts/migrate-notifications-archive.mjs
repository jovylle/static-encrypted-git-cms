/**
 * One-time merge: my-json-database notification archive + CMS flat notifications.json
 * → data/source/notifications/{pinned,YYYY-MM-DD}.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ARCHIVE_DIR = path.resolve(ROOT, '../my-json-database/public/notifications');
const CMS_FLAT = path.join(ROOT, 'data/source/notifications.json');
const OUT_DIR = path.join(ROOT, 'data/source/notifications');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function enrich(item) {
  const date =
    item.date ||
    (item.timestamp && String(item.timestamp).slice(0, 10)) ||
    '2026-01-01';
  const timestamp =
    item.timestamp ||
    (date.includes('T') ? date : `${date}T12:00:00Z`);
  const type = item.type === 'announcement' ? 'success' : item.type || 'info';
  let message = item.message || '';
  if (item.link?.url && !message.includes(item.link.url)) {
    const label = item.link.label ? `${item.link.label}: ` : '';
    message = `${message} ${label}${item.link.url}`.trim();
  }
  return {
    ...item,
    type,
    message,
    date,
    timestamp,
    status: item.status || 'published',
    private: item.private === true,
    tags: Array.isArray(item.tags) && item.tags.length ? item.tags : ['all', 'jovylle.com'],
    persistent: item.persistent ?? false,
  };
}

function bundleKeyFromFile(file, item) {
  if (file === 'pinned.json') return 'pinned';
  const m = file.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
  if (m) return m[1];
  return item.date || (item.timestamp && String(item.timestamp).slice(0, 10)) || 'unknown';
}

function addToBundles(bundles, key, item) {
  if (!bundles.has(key)) bundles.set(key, new Map());
  bundles.get(key).set(item.id, enrich(item));
}

if (!fs.existsSync(ARCHIVE_DIR)) {
  console.error('Archive not found:', ARCHIVE_DIR);
  process.exit(1);
}

const bundles = new Map();

for (const file of fs.readdirSync(ARCHIVE_DIR)) {
  if (!file.endsWith('.json') || file === 'index.json') continue;
  const data = readJson(path.join(ARCHIVE_DIR, file));
  for (const n of data.notifications || []) {
    addToBundles(bundles, bundleKeyFromFile(file, n), n);
  }
}

if (fs.existsSync(CMS_FLAT)) {
  const cms = readJson(CMS_FLAT);
  for (const n of cms.notifications || []) {
    const key = n.date || (n.timestamp && String(n.timestamp).slice(0, 10)) || 'unknown';
    addToBundles(bundles, key, n);
  }
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const written = [];
for (const [key, byId] of bundles) {
  const notifications = [...byId.values()].sort((a, b) =>
    String(b.timestamp || b.date).localeCompare(String(a.timestamp || a.date)),
  );
  const outName = key === 'pinned' ? 'pinned.json' : `${key}.json`;
  const outPath = path.join(OUT_DIR, outName);
  fs.writeFileSync(outPath, `${JSON.stringify({ notifications }, null, 2)}\n`);
  written.push(`${outName} (${notifications.length})`);
}

console.log('Wrote notification bundles:');
for (const line of written.sort()) console.log(' ', line);

const allIds = new Set();
let dupes = 0;
for (const [, byId] of bundles) {
  for (const id of byId.keys()) {
    if (allIds.has(id)) dupes += 1;
    allIds.add(id);
  }
}
console.log(`Total unique ids: ${allIds.size}${dupes ? ` (${dupes} duplicate keys resolved by last write)` : ''}`);
