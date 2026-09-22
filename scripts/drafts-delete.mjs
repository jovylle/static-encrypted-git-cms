import fs from "fs";
import path from "path";

// Delete a draft's local files: data/source/blogs/<slug>.json +
// data/encrypted/blogs/<slug>.json.enc (if present).
// Does NOT record a rejection — use drafts-reject.mjs when the topic itself
// is not worth posting, so the bridge never regenerates it.
// Usage: node scripts/drafts-delete.mjs --slug <slug>

const rootDir = path.resolve(process.cwd());

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--slug") out.slug = argv[++i];
  }
  return out;
}

const { slug } = parseArgs(process.argv);
if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
  console.error("Usage: node scripts/drafts-delete.mjs --slug <slug>");
  process.exit(1);
}

const src = path.join(rootDir, "data", "source", "blogs", `${slug}.json`);
const enc = path.join(rootDir, "data", "encrypted", "blogs", `${slug}.json.enc`);
let removed = [];
for (const f of [src, enc]) {
  if (fs.existsSync(f)) {
    fs.rmSync(f);
    removed.push(path.relative(rootDir, f));
  }
}
if (!removed.length) {
  console.error(`No files found for slug: ${slug}`);
  process.exit(1);
}
console.log(`Deleted draft ${slug}:`);
removed.forEach((f) => console.log(`  - ${f}`));
console.log("Note: topic NOT blocklisted — bridge may suggest it again. Use drafts-reject for that.");
