import fs from "fs";
import path from "path";

const HINDSIGHT_URL =
  process.env.HINDSIGHT_API_URL || process.env.HINDSIGHT_URL || "http://localhost:8888";
const HINDSIGHT_BANK =
  process.env.HINDSIGHT_BANK_ID || process.env.HINDSIGHT_BANK || "jovylle";
const HINDSIGHT_KEY =
  process.env.HINDSIGHT_API_TENANT_API_KEY || process.env.HINDSIGHT_API_KEY || "";

function parseArgs(argv) {
  const args = process.argv.slice(2);
  const out = { limit: 3, tags: "", tagsMatch: "any" };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--query" || arg === "-q") out.query = args[++i];
    else if (arg === "--limit" || arg === "-n") out.limit = Number(args[++i] || out.limit);
    else if (arg === "--include-based-on") out.includeBasedOn = true;
    else if (arg === "--tags") out.tags = args[++i] || "";
    else if (arg === "--tags-match") out.tagsMatch = args[++i] || "any";
  }
  return out;
}

function loadExistingBlogSlugs(rootDir) {
  const sourceBlogsDir = path.join(rootDir, "data", "source", "blogs");
  if (!fs.existsSync(sourceBlogsDir)) return new Set();
  const files = fs.readdirSync(sourceBlogsDir).filter((f) => f.endsWith(".json"));
  const slugs = new Set();
  for (const file of files) {
    slugs.add(file.replace(/\.json$/, ""));
  }
  return slugs;
}

function extractString(x) {
  if (typeof x === "string") return x;
  if (x && typeof x === "object") {
    if (typeof x.text === "string") return x.text;
    if (typeof x.content === "string") return x.content;
    if (typeof x.result === "string") return x.result;
  }
  return "";
}

function extractJsonFromText(text) {
  if (!text) return null;
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : text.trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function fetchHindsight(route, body) {
  const url = `${HINDSIGHT_URL}/v1/default/banks/${HINDSIGHT_BANK}/${route}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${HINDSIGHT_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Hindsight ${route} failed (${res.status}): ${text}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
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

function ensureSlugUnique(slug, existing) {
  if (!existing.has(slug)) return slug;
  let n = 2;
  while (existing.has(`${slug}-${n}`)) n += 1;
  return `${slug}-${n}`;
}

function parseScorePayload(text) {
  const payload = extractJsonFromText(text);
  if (!payload || typeof payload !== "object") return null;

  const axes = payload.axis_scores || payload.axisScores || {};
  const score =
    typeof payload.score === "number"
      ? payload.score
      : Number(payload.total_score ?? payload.rating ?? NaN);

  if (!Number.isFinite(score)) return null;

  return {
    score,
    axisScores: {
      novel: Number(axes.novel ?? 0),
      audience: Number(axes.audience ?? 0),
      portfolio: Number(axes.portfolio ?? 0),
      privacy: Number(axes.privacy ?? 0),
      effort: Number(axes.effort ?? 0),
    },
    reason: String(payload.reason || ""),
    risks: Array.isArray(payload.risks) ? payload.risks : [],
    suggestedSlug: String(payload.suggested_slug || payload.suggestedSlug || ""),
  };
}

function buildCandidateItem({ recallItem, reflectText, scoring, slug, query, includeBasedOn }) {
  const recallContent =
    recallItem.content ||
    recallItem.text ||
    recallItem.summary ||
    recallItem.document_content ||
    "";
  return {
    query,
    slug,
    recallText: String(recallContent).trim(),
    recallScores: recallItem.scores || recallItem.scores_json || null,
    recallId: recallItem.id || recallItem.memory_id || recallItem.unit_id || null,
    reflectText: String(reflectText || "").trim(),
    scoring,
    basedOn: includeBasedOn ? recallItem.based_on || recallItem.basedOn || undefined : undefined,
  };
}

async function run() {
  const { query, limit, tags, tagsMatch, includeBasedOn } = parseArgs(process.argv);
  if (!query) throw new Error("Missing --query");

  const rootDir = path.resolve(process.cwd());
  const existingSlugs = loadExistingBlogSlugs(rootDir);

  const reflectPrompt = [
    `You are a blog-worthiness scorer for jovylle.com.`,
    `Question: ${query}`,
    `Apply the rubric: score 0-10 on five axes (novel, audience, portfolio, privacy, effort), each 0-2.`,
    `Rules: deduplicate against these existing blog slugs: ${[...existingSlugs].join(", ") || "(none)"}.`,
    `Never output secrets, tailnet IPs, API keys, or internal hostnames in reasons.`,
    `Return JSON ONLY: {"score":number,"axis_scores":{"novel":0,"audience":0,"portfolio":0,"privacy":0,"effort":0},"reason":"...","risks":["..."],"suggested_slug":"..."}`
  ].join("\n");

  const [recallPayload, reflectPayload] = await Promise.all([
    fetchHindsight("memories/recall", { query, limit, include_citations: false }),
    fetchHindsight("reflect", {
      query: reflectPrompt,
      budget: "low",
      max_tokens: 1200,
      tags: tags ? tags.split(",").map((s) => s.trim()).filter(Boolean) : null,
      tags_match: tagsMatch || "any",
      include_based_on: Boolean(includeBasedOn),
      include_trace: false,
      apply_all_directives: true,
    }),
  ]);

  const recallResults = recallPayload.results || recallPayload.items || [];
  const reflectText = extractString(reflectPayload.text) || reflectPayload.raw || "";
  const scoring = parseScorePayload(reflectText);
  const slug = ensureSlugUnique(
    scoring?.suggestedSlug ? slugify(scoring.suggestedSlug) : slugify(query),
    existingSlugs
  );

  const candidates = [
    buildCandidateItem({
      recallItem: recallResults[0] || {},
      reflectText,
      scoring,
      slug,
      query,
      includeBasedOn,
    }),
  ];

  const output = {
    query,
    limit,
    slug,
    reflectWorkingModel: reflectPayload.model || reflectPayload.provider || null,
    scoring,
    candidates,
  };

  const outDir = path.join(rootDir, "tmp");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "hindsight-candidate-latest.json");
  fs.writeFileSync(outFile, JSON.stringify(output, null, 2) + "\n");

  console.log(JSON.stringify(output, null, 2));
  console.log(`\nWrote ${outFile}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
