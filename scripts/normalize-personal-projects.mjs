#!/usr/bin/env node
/**
 * Rewrite data/source/personal-projects.json to the canonical schema shape.
 * For Supabase priority_score / tech / links, run import first:
 *   npm run data:import-personal-projects-from-supabase -- <portfolio_projects_rows.csv>
 */

import fs from 'fs';
import path from 'path';
import { SOURCE_DIR } from './lib/data-paths.mjs';
import { normalizePersonalProjectsFile } from './lib/personal-project-normalize.mjs';

const OUT = path.join(SOURCE_DIR, 'personal-projects.json');

function main() {
  if (!fs.existsSync(OUT)) {
    console.error(`Missing ${OUT} — run npm run data:decrypt first.`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const out = normalizePersonalProjectsFile(raw);
  fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  console.log(`Normalized ${out.projects.length} projects → ${OUT}`);
}

main();
