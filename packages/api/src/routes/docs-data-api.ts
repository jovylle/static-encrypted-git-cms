// Mirrors docs/DATA-API.md — keep both in sync when this doc changes.

export function handleDocsDataApi(): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Data API (Cloudflare D1) — Consumer Guide</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 700px; margin: 4rem auto; padding: 0 1rem; line-height: 1.6; color: #1f2937; }
  h1 { font-size: 1.6rem; margin-bottom: 0.5rem; }
  h2 { font-size: 1.2rem; margin-top: 2.5rem; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.3rem; }
  a { color: #2563eb; }
  code { background: #f3f4f6; padding: 0.1rem 0.35rem; border-radius: 4px; font-size: 0.9em; }
  pre { background: #111827; color: #f9fafb; padding: 1rem; border-radius: 6px; overflow-x: auto; }
  pre code { background: none; padding: 0; color: inherit; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: 0.92rem; }
  th, td { border: 1px solid #e5e7eb; padding: 0.4rem 0.6rem; text-align: left; vertical-align: top; }
  th { background: #f9fafb; }
  .muted { color: #6b7280; font-size: 0.9em; }
</style>
</head>
<body>

<h1>Data API (Cloudflare D1) — Consumer Guide</h1>

<p>The dynamic, high-write side of this project's data lives in a Cloudflare D1 database
(<code>cms-db</code>, bound as <code>env.DB</code> in <code>packages/api/</code>) — separate from the encrypted git-backed
JSON collections (projects, blogs, notifications) documented in the main
<a href="https://github.com/jovylle/static-encrypted-git-cms/blob/master/README.md#consuming-content-portfolio--other-apps">README's "Consuming content" section</a>.
This doc covers the 9 D1 tables and their HTTP endpoints, for apps like <code>playbase</code> or
<code>fast.jovylle.com</code> that want to read or write this data.</p>

<p><strong>Base URL:</strong> <code>https://content.jovylle.com</code></p>

<p>CORS is wide open (<code>Access-Control-Allow-Origin: *</code>), so you can <code>fetch()</code> straight from a
browser app — no proxy needed.</p>

<h2>Auth</h2>

<p>Some endpoints are public (safe for a visitor-facing site to call directly); others require
the admin credential and are meant for <strong>your own backend/admin tooling only</strong> — never ship
the admin password into client-side JS.</p>

<pre><code>const auth = 'Basic ' + btoa(\`admin:\${ADMIN_PASSWORD}\`);
fetch('https://content.jovylle.com/api/contacts', { headers: { Authorization: auth } });</code></pre>

<h2>Rate limits</h2>

<table>
<tr><th>Category</th><th>Limit</th></tr>
<tr><td><code>read</code> (GET)</td><td>60 requests/min per IP</td></tr>
<tr><td><code>write</code> (POST/PUT/DELETE)</td><td>30 requests/min per IP</td></tr>
</table>

<p>Responses include <code>x-ratelimit-limit</code> / <code>x-ratelimit-remaining</code> headers; a 429 includes
<code>retryAfter</code> seconds.</p>

<h2>Endpoints</h2>

<table>
<tr><th>Resource</th><th>Method &amp; path</th><th>Auth</th><th>Notes</th></tr>
<tr><td rowspan="5"><strong>Feature flags</strong></td><td><code>GET /api/feature-flags</code></td><td>public</td><td>list all</td></tr>
<tr><td><code>GET /api/feature-flags/{key}</code></td><td>public</td><td>single flag</td></tr>
<tr><td><code>POST /api/feature-flags</code> <code>{key, enabled?, description?}</code></td><td>admin</td><td>create</td></tr>
<tr><td><code>PUT /api/feature-flags/{key}</code> <code>{enabled?, description?}</code></td><td>admin</td><td>update</td></tr>
<tr><td><code>DELETE /api/feature-flags/{key}</code></td><td>admin</td><td>delete</td></tr>

<tr><td rowspan="4"><strong>Contact submissions</strong></td><td><code>POST /api/contacts</code> <code>{name, email, subject?, message}</code></td><td>public</td><td>your contact form posts here</td></tr>
<tr><td><code>GET /api/contacts</code> / <code>GET /api/contacts/{id}</code></td><td>admin</td><td>read</td></tr>
<tr><td><code>PUT /api/contacts/{id}</code> <code>{status}</code></td><td>admin</td><td>status &isin; <code>unread|read|replied|spam</code></td></tr>
<tr><td><code>DELETE /api/contacts/{id}</code></td><td>admin</td><td></td></tr>

<tr><td rowspan="5"><strong>Conversations</strong> (chat threads)</td><td><code>POST /api/conversations</code> <code>{title?, message}</code></td><td>public</td><td>creates thread + first message</td></tr>
<tr><td><code>GET /api/conversations</code></td><td>public</td><td>flat list (no messages)</td></tr>
<tr><td><code>GET /api/conversations/{id}</code></td><td>public</td><td>single thread <strong>with</strong> its <code>messages[]</code></td></tr>
<tr><td><code>POST /api/conversations/{id}/messages</code> <code>{role?, content}</code></td><td>public</td><td>append a message</td></tr>
<tr><td><code>PUT /api/conversations/{id}</code> <code>{title}</code></td><td>admin</td><td>rename</td></tr>
<tr><td><code>DELETE /api/conversations/{id}</code></td><td>admin</td><td></td></tr>

<tr><td rowspan="5"><strong>Comments</strong></td><td><code>GET /api/comments?target_type=&amp;target_id=</code></td><td>public</td><td>only <code>status: approved</code></td></tr>
<tr><td><code>POST /api/comments</code> <code>{target_type, target_id, author_name, author_email?, content}</code></td><td>public</td><td>starts as <code>pending</code>, needs moderation</td></tr>
<tr><td><code>GET /api/comments/all</code></td><td>admin</td><td>all statuses</td></tr>
<tr><td><code>PUT /api/comments/{id}</code> <code>{status}</code></td><td>admin</td><td>status &isin; <code>approved|rejected|spam</code></td></tr>
<tr><td><code>DELETE /api/comments/{id}</code></td><td>admin</td><td></td></tr>

<tr><td rowspan="3"><strong>Likes</strong></td><td><code>POST /api/likes/toggle</code> <code>{target_type, target_id, visitor_id}</code></td><td>public</td><td>toggles like on/off, returns <code>{liked, count}</code></td></tr>
<tr><td><code>GET /api/likes/count?target_type=&amp;target_id=</code></td><td>public</td><td>count for one target</td></tr>
<tr><td><code>GET /api/likes</code></td><td>admin</td><td>full raw list of all like rows</td></tr>

<tr><td rowspan="4"><strong>Todos</strong></td><td><code>GET /api/todos</code> / <code>GET /api/todos/{id}</code></td><td>admin</td><td></td></tr>
<tr><td><code>POST /api/todos</code> <code>{title, content?, status?, priority?}</code></td><td>admin</td><td>status &isin; <code>open|in_progress|done</code></td></tr>
<tr><td><code>PUT /api/todos/{id}</code> (any subset of same fields)</td><td>admin</td><td></td></tr>
<tr><td><code>DELETE /api/todos/{id}</code></td><td>admin</td><td></td></tr>

<tr><td rowspan="3"><strong>Scores</strong> (game leaderboards)</td><td><code>GET /api/scores?game=&amp;sort=top|recent&amp;limit=</code></td><td>public</td><td>returns <code>{scores: [...]}</code>; <code>sort=top</code> = fastest <code>ms</code> first, <code>sort=recent</code> (default) = newest first; <code>limit</code> default 10, max 200; filter by <code>game</code></td></tr>
<tr><td><code>POST /api/scores</code> <code>{game, ms, playerName, playerId}</code></td><td>admin</td><td><code>ms</code> = positive integer (lower is better); returns the created row</td></tr>
<tr><td><code>DELETE /api/scores/{id}</code></td><td>admin</td><td></td></tr>

<tr><td><strong>Audit log</strong></td><td><code>GET /api/audit-logs</code></td><td>admin</td><td>read-only, capped at latest 100 rows</td></tr>
</table>

<h2><code>target_type</code> / <code>target_id</code> convention</h2>

<p>Comments and likes are generic — <code>target_type</code> is whatever your app calls the thing being
commented/liked (e.g. <code>"blog-post"</code>, <code>"project"</code>), <code>target_id</code> is that item's slug/id. Use
the same pair consistently across comments and likes for a given entity if you want them to
line up.</p>

<h2>Browsing without code</h2>

<p>Everything above (except <code>contacts</code>/<code>comments</code>/<code>todos</code> which need admin), plus the admin-only
ones, can be <strong>eyeballed</strong> at <a href="/admin/">https://content.jovylle.com/admin/</a> &rarr; "Data (D1)" section —
read-only tables, no write UI yet. Handy for debugging without writing a script, but it
requires the admin password just like the endpoints above. (<code>scores</code> isn't wired into this
viewer yet — its <code>GET</code> returns a <code>{scores: [...]}</code> envelope instead of a bare array, which
the viewer doesn't unwrap; query <code>/api/scores</code> directly to inspect it for now.)</p>

<p class="muted">This same content is also served at <code>https://content.jovylle.com/docs/data-api</code> for quick
reference without opening the repo.</p>

</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' },
  });
}
