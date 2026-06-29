const fs = require('fs');
const path = require('path');

const notificationsDir = path.join(__dirname, 'public', 'notifications');
const indexFile = path.join(notificationsDir, 'index.json');
const pinnedFilename = 'pinned.json';

if (!fs.existsSync(notificationsDir)) {
  console.warn('[warn] public/notifications/ not found — run npm run data:export first');
  process.exit(0);
}

const files = fs
  .readdirSync(notificationsDir)
  .filter((filename) => filename.endsWith('.json') && filename !== 'index.json');

const pinnedEntry = files.includes(pinnedFilename) ? [pinnedFilename] : [];
const otherFiles = files
  .filter((filename) => filename !== pinnedFilename)
  .sort((a, b) => b.localeCompare(a));

const orderedFiles = [...pinnedEntry, ...otherFiles];

fs.writeFileSync(indexFile, `${JSON.stringify({ files: orderedFiles }, null, 2)}\n`);
console.log('Notifications index generated:', indexFile);
