import fs from 'fs';
import path from 'path';
import { ROOT, SEED_REPO } from './lib/data-paths.mjs';
import { copyDirRecursive } from './lib/data-io.mjs';

const imagesSeedRoot = path.join(SEED_REPO, 'public', 'images');
const imagesDestRoot = path.join(ROOT, 'public', 'images');

if (!fs.existsSync(imagesSeedRoot)) {
  console.error(`Seed images not found: ${imagesSeedRoot}`);
  console.error('Expected my-json-database at:', SEED_REPO);
  process.exit(1);
}

copyDirRecursive(imagesSeedRoot, imagesDestRoot);
console.log(`Synced ${imagesSeedRoot} → public/images/`);
