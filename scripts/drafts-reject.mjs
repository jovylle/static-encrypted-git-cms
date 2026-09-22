import fs from "fs";
import path from "path";

// Reject a draft as "not worth posting": deletes local files AND appends the
// slug to data/source/blogs/_rejected.json (gitignored, local only).
// The hindsight-to-blog bridge reads _rejected.json via existing_slugs() and
// never regenerates those topics.
// Usage: node scripts/drafts-reject.mjs --slug <slug> [--reason "..."]

const rootDir = path.resolve(process.cwd());
const blogsDir = path.join(rootDir, "data", "source", "blogs");
const rejectedFile = path.join(blogsDir, "_rejected.json");

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--slug") out.slug = argv[++i];
    else if (argv[i] === "--reason") out.reason = argv[++i];
  }
  return out;
}

const { slug, reason } = parseArgs(process.argv);
if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
  console.error("Usage: node scripts/drafts-reject.mjs --slug <slug> [--reason ...]");
  process.exit(1);
}

// 1. delete files
const src = path.join(blogsDir, `${slug}.json`);
const enc = path.join(rootDir, "data", "encrypted", "blogs", `${slug}.json.enc`);
for (const f of [src, enc]) {
  if (fs.existsSync(f)) {
    fs.rmSync(f);
    console.log(`  deleted ${path.relative(rootDir, f)}`);
  }
}

// 2. record rejection
let log = [];
if (fs.existsSync(rejectedFile)) {
  try { log = JSON.parse(fs.readFileSync(rejectedFile, "utf8")); } catch { log = []; }
}
if (!Array.isArray(log)) log = [];
if (!log.some((e) => e.slug === slug)) {
  // capture title before delete if still possible (already deleted — read from enc? no. use slug)
  log.push({ slug, reason: reason || "", rejected_at: new Date().toISOString() });
  fs.writeFileSync(rejectedFile, JSON.stringify(log, null, 2) + "\n");
  console.log(`  blocklisted ${slug} in data/source/blogs/_rejected.json`);
} else {
  console.log(`  ${slug} already blocklisted`);
}
console.log(`Rejected ${slug} — bridge will not regenerate it.`);
