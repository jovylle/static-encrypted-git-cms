import fs from "fs";
import path from "path";

// Reads tmp/hindsight-candidate-latest.json (or --from <file>) and writes a
// gated draft to data/source/blogs/{slug}.json:
//   status:"draft", private:true, frontmatter draft:true
// => isPublicBlogPost() returns false => never exported until a human flips it.
// Never touches an existing published post without --force.

const SCRUB_PATTERNS = [
  /\b100\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,          // tailnet IPs
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,                          // API keys
  /CLOUDFLARE_API_TOKEN\s*=\s*[^\s\n]+/gi,            // CF token assignments
  /HINDSIGHT_API_TENANT_API_KEY\s*=\s*[^\s\n]+/gi,    // hindsight key assignments
  /\b[a-z0-9-]+\.bongo-major\.ts\.net\b/gi,           // tailnet hostnames
];

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = { from: null, slug: null, title: null, force: false, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--from") out.from = args[++i];
    else if (a === "--slug") out.slug = args[++i];
    else if (a === "--title") out.title = args[++i];
    else if (a === "--force") out.force = true;
    else if (a === "--dry-run") out.dryRun = true;
  }
  return out;
}

function scrub(text) {
  let out = String(text || "");
  for (const re of SCRUB_PATTERNS) out = out.replace(re, "[redacted]");
  return out;
}

function slugify(text) {
  const base = (text || "untitled-post")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return base || "untitled-post";
}

function validateDraft(d) {
  const errors = [];
  if (!d.slug || typeof d.slug !== "string") errors.push("slug required");
  else if (!/^[a-z0-9-]+$/.test(d.slug)) errors.push("slug must match ^[a-z0-9-]+$");
  if (!["published", "draft", "private", ""].includes(d.status)) errors.push(`bad status: ${d.status}`);
  if (typeof d.private !== "boolean") errors.push("private must be boolean");
  if (d.status !== "draft" || d.private !== true) errors.push("gate violated: drafts must be status:draft + private:true");
  return errors;
}

function buildDraft({ candidate, slugOverride, titleOverride }) {
  const scoring = candidate.scoring || {};
  const slug = slugOverride || candidate.slug || slugify(scoring.suggestedSlug || candidate.query);
  const title = titleOverride || `Draft: ${slug.replace(/-/g, " ")}`;
  const now = new Date().toISOString();
  const dateDay = now.slice(0, 10);

  const reason = scrub(scoring.reason || candidate.reflectText || "").slice(0, 900);
  const risks = Array.isArray(scoring.risks) ? scoring.risks.map(scrub) : [];
  const excerpt = scrub(
    scoring.reason ? scoring.reason.slice(0, 157) + "..." : `Draft candidate scored ${scoring.score ?? "?"}/10 by hindsight.`
  );

  const content = [
    `# ${title}`,
    ``,
    `> DRAFT — generated from hindsight candidate scoring (${scoring.score ?? "?"}/10). Edit freely, then flip status to published.`,
    ``,
    `## Why this might be worth a post`,
    ``,
    reason || "_No scoring reason captured — fill in from memory._",
    ``,
    risks.length ? `## Risks / things to scrub` + "\n\n" + risks.map((r) => `- ${r}`).join("\n") + `\n` : ``,
    `## Outline (fill in)`,
    ``,
    `- Hook: `,
    `- What I built: `,
    `- How it works (code): `,
    `- Gotchas: `,
    `- Links: repo / live demo`,
    ``,
  ].join("\n");

  const body = [
    `---`,
    `title: "${title.replace(/"/g, "\\\"")}"`,
    `date: ${now}`,
    `categories: ["draft"]`,
    `featured: false`,
    `draft: true`,
    `author: "Jovylle Bermudez"`,
    `---`,
    ``,
  ].join("\n");

  return {
    slug,
    title,
    excerpt,
    author: "Jovylle Bermudez",
    date: dateDay,
    status: "draft",
    private: true,
    featured: false,
    tags: ["draft"],
    thumbnail: "",
    load_readme_from_this_repo: "",
    content,
    body,
  };
}

async function run() {
  const opts = parseArgs(process.argv);
  const rootDir = path.resolve(process.cwd());
  const blogsDir = path.join(rootDir, "data", "source", "blogs");
  const fromFile = opts.from || path.join(rootDir, "tmp", "hindsight-candidate-latest.json");
  if (!fs.existsSync(fromFile)) throw new Error(`Candidate file not found: ${fromFile} (run blog:candidate first)`);
  const candidate = JSON.parse(fs.readFileSync(fromFile, "utf8"));

  const draft = buildDraft({ candidate, slugOverride: opts.slug, titleOverride: opts.title });
  const errors = validateDraft(draft);
  if (errors.length) throw new Error("Draft invalid: " + errors.join("; "));

  const outPath = path.join(blogsDir, `${draft.slug}.json`);
  if (fs.existsSync(outPath)) {
    const existing = JSON.parse(fs.readFileSync(outPath, "utf8"));
    if ((existing.status === "published" || existing.private === false) && !opts.force) {
      throw new Error(`Refusing to overwrite published post ${draft.slug} without --force`);
    }
    if (!opts.force) throw new Error(`Draft ${draft.slug} already exists (use --force to overwrite a draft)`);
  }

  if (opts.dryRun) {
    console.log(JSON.stringify({ outPath, draft }, null, 2));
    console.log("\nDry run — nothing written.");
    return;
  }

  fs.mkdirSync(blogsDir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(draft, null, 2) + "\n");
  console.log(`Wrote draft: ${outPath}`);
  console.log("Gate check: status=draft + private:true + frontmatter draft:true => excluded from export until you flip it.");
}

run().catch((err) => { console.error(err.message || err); process.exit(1); });
