import fs from "fs";
import path from "path";

// Reads data/source/blogs/*.json drafts (status draft/private or private:true),
// renders each content markdown to readable HTML, shows social helper +
// exact publish commands. Output: public/drafts-preview.html (gitignored via
// public/data/* exception? NO — write to ./drafts-preview.html at root instead
// so it never touches public/ or data/. Open via vite dev or file://).
//
// Usage: npm run drafts:preview && npm run dev
// Then: http://localhost:5173/drafts-preview.html (copy to public/ first — see below)
// Or without any server: open drafts-preview.html (file:// works, all inline).

const rootDir = path.resolve(process.cwd());
const blogsDir = path.join(rootDir, "data", "source", "blogs");

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Minimal markdown -> HTML (headings, bold, code, lists, paragraphs, links).
function md(src) {
  const lines = String(src || "").split("\n");
  let html = "";
  let inList = false;
  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) {
      if (inList) { html += "</ul>"; inList = false; }
      const level = line.match(/^(#{1,6})/)[1].length;
      html += `<h${level}>${inline(line.replace(/^#{1,6}\s/, ""))}</h${level}>`;
    } else if (/^(\-|\*)\s+/.test(line)) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${inline(line.replace(/^(\-|\*)\s+/, ""))}</li>`;
    } else if (/^\d+\.\s+/.test(line)) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${inline(line.replace(/^\d+\.\s+/, ""))}</li>`;
    } else if (/^&gt;/.test(esc(line)) || line.startsWith(">")) {
      if (inList) { html += "</ul>"; inList = false; }
      html += `<blockquote>${inline(line.replace(/^>\s?/, ""))}</blockquote>`;
    } else if (line.trim() === "") {
      if (inList) { html += "</ul>"; inList = false; }
    } else {
      if (inList) { html += "</ul>"; inList = false; }
      html += `<p>${inline(line)}</p>`;
    }
  }
  if (inList) html += "</ul>";
  return html;
}

function inline(s) {
  let out = esc(s);
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/`(.+?)`/g, "<code>$1</code>");
  out = out.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  return out;
}

function isDraft(j) {
  return j.status === "draft" || j.status === "private" || j.private === true;
}

const files = fs.existsSync(blogsDir) ? fs.readdirSync(blogsDir).filter((f) => f.endsWith(".json")) : [];
const drafts = [];
for (const f of files) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(blogsDir, f), "utf8"));
    if (isDraft(j) && j.slug !== "draft-template") drafts.push(j);
  } catch { /* skip bad json */ }
}
drafts.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

const cards = drafts.map((d) => {
  const social = d.social || {};
  const thread = Array.isArray(social.x_thread) ? social.x_thread : [];
  const pubCmd = [
    `# publish ${d.slug}`,
    `cd /Volumes/DevSSD/fore/lab/static-encrypted-git-cms`,
    `# 1. edit data/source/blogs/${d.slug}.json — flip "status": "draft" → "published"`,
    `npm run data:save`,
    `npm run data:export-dry-run 2>&1 | grep ${d.slug}   # must show ✓ export`,
    `git add data/encrypted/blogs/${d.slug}.json.enc`,
    `git commit -m "content: publish ${d.slug} blog post"`,
    `git push origin master`,
    `curl -s https://content.jovylle.com/data/blogs/${d.slug}.json | python3 -c "import json,sys; print(json.load(sys.stdin)['title'])"`,
  ].join("\n");
  return `
  <article class="card" id="${esc(d.slug)}">
    <div class="meta">${esc(d.date || "")} · ${esc((d.tags || []).join(", "))} · status: ${esc(d.status)}${d.private ? " · private" : ""}</div>
    <h2>${esc(d.title)}</h2>
    <p class="excerpt">${esc(d.excerpt || "")}</p>
    <div class="post">${md(d.content)}</div>
    <details><summary>social helper (copy-paste)</summary>
      <h4>X (${(social.x || "").length}/280)</h4><pre>${esc(social.x || "")}</pre>
      <h4>X thread (${thread.length})</h4>${thread.map((t, i) => `<pre>${i + 1}. ${esc(t)}</pre>`).join("")}
      <h4>Facebook</h4><pre>${esc(social.facebook || "")}</pre>
      <h4>LinkedIn</h4><pre>${esc(social.linkedin || "")}</pre>
    </details>
    <details><summary>publish commands</summary><pre>${esc(pubCmd)}</pre></details>
    <div class="actions">
      <button onclick="navigator.clipboard.writeText(document.querySelector('#${esc(d.slug)} pre:last-child').innerText)">copy publish cmds</button>
      <a href="https://content.jovylle.com/data/blogs/${esc(d.slug)}.json" target="_blank">live URL (404 while draft)</a>
    </div>
  </article>`;
}).join("\n");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Drafts preview (${drafts.length}) — content.jovylle.com</title>
<style>
:root{color-scheme:light}body{font-family:system-ui,sans-serif;max-width:860px;margin:0 auto;padding:1rem 1rem 3rem;line-height:1.6}
.meta{color:#666;font-size:.85rem}.card{border:1px solid #ddd;border-radius:12px;padding:1.2rem;margin:1.2rem 0}
.excerpt{color:#444;font-style:italic}pre{background:#f5f5f5;padding:.7rem;border-radius:8px;white-space:pre-wrap;font-size:.82rem}
details{margin:.8rem 0}summary{cursor:pointer;font-weight:600}blockquote{border-left:3px solid #ccc;margin:0;padding-left:.8rem;color:#555}
.actions{display:flex;gap:1rem;margin-top:.6rem;font-size:.85rem}h2{margin:.3rem 0}
nav.toc{background:#fafafa;border:1px solid #eee;border-radius:10px;padding:.8rem 1rem;margin-bottom:1rem}
</style></head><body>
<h1>Drafts preview (${drafts.length})</h1>
<p>Generated ${new Date().toISOString()} from <code>data/source/blogs/</code> (local only, never committed). Start server: <code>npm run drafts</code> → <a href="http://localhost:5173/drafts-preview.html">localhost:5173/drafts-preview.html</a>. Kill with Ctrl-C when done — nothing autostarts.</p>
<nav class="toc"><strong>Drafts:</strong><ul>${drafts.map((d) => `<li><a href="#${esc(d.slug)}">${esc(d.title)}</a></li>`).join("")}</ul></nav>
${cards || "<p>No drafts found.</p>"}
</body></html>`;

fs.writeFileSync(path.join(rootDir, "public", "drafts-preview.html"), html + "\n");
console.log(`Wrote public/drafts-preview.html with ${drafts.length} drafts: ${drafts.map((d) => d.slug).join(", ")}`);
console.log("Run: npm run drafts  →  http://localhost:5173/drafts-preview.html  (Ctrl-C to stop, nothing autostarts)");
