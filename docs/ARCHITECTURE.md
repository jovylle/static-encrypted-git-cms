# Architecture

Snapshot of how `content.jovylle.com` is actually served today, post-Netlify. See
[README.md](../README.md) for the editing workflow and [ECOSYSTEM.md](./ECOSYSTEM.md) for the
consumer-tier breakdown; this doc is the "how the Worker is put together" reference.

## Single Worker, two jobs

`packages/api/` is one Cloudflare Worker (`content-api`, see `wrangler.jsonc`) that owns
`content.jovylle.com` end to end:

1. **Public content API** — `GET /data/*` and `GET /images/*` (see [Two independent read paths](../README.md#two-independent-read-paths) in the README).
2. **Admin API** — `/api/admin/*`, backing the `/admin/` dashboard SPA (served by
   `routes/admin/admin-html.ts`).

There is no separate Netlify site and no `netlify/functions/` — that implementation was deleted;
it was never actually reachable in production because Cloudflare's CDN blocked POSTs to
`/.netlify/functions/*`.

## Public data routes

`packages/api/src/routes/data-file.ts` + `router.ts`:

- **Root files** (`ROOT_FILES` map) — `personal-projects.json`, `projects.json`,
  `highlights.json`, `profile.json`, `resume.json`, `homepage.json`, `social.json`, `uses.json`,
  `fast-scores.json`. Each decrypts its matching `data/encrypted/*.json.enc` straight from the
  GitHub Contents API on every request — no build, no filesystem cache. `filterPublic` (draft/
  private stripping) is wired up for `personal-projects.json` and `projects.json`; the rest are
  served in full.
- **Blogs** — `GET /data/blogs/index.json`, `GET /data/blogs/{slug}.json`, decrypted from
  `data/encrypted/blogs/` on request.
- **Notifications** — `GET /data/notifications.json` (flattened, deduped by id), `GET
  /data/notifications/{slug}.json`, decrypted from `data/encrypted/notifications/` on request.

A second, independent code path (`scripts/data-export.mjs` → `public/data/`, run by
`predev`/`prebuild`) produces the same collections for the static Vite build (`dist/`), used for
local preview and whatever static hosting serves `dist/` in front of/alongside the Worker. The two
paths read the same ciphertext through different filter code (`data-file.ts`'s `filterPublic` vs.
`scripts/lib/public-filter.mjs`) — keep both in sync when changing visibility rules.

Adding a new root-level collection meant to be Worker-served requires adding it to `ROOT_FILES` in
`data-file.ts`, or it 404s on the live path even if the static export already produces it.

## Admin panel

Single-page app served by `routes/admin/admin-html.ts` (no build step, no framework — plain HTML/
CSS/JS returned directly from the Worker). It authenticates against the Worker's own session/
password model and calls `/api/admin/*` for every mutation.

**Route call chain** (see [CLAUDE.md](../CLAUDE.md) for the full breakdown):

```
routes/admin/*.ts (handler: parse request, check auth)
  -> middleware/auth.ts            (Basic-auth header OR session cookie — the only two mechanisms)
  -> lib/admin-collections.ts      (EDITABLE_COLLECTIONS registry: key -> filePath/dirPath)
  -> read-merge-write flow
       -> lib/encrypted-content-store.ts  (decrypt/encrypt JSON payload)
       -> lib/github-content.ts           (GitHub Contents API: get/put/delete file, PR or direct commit)
  -> lib/validate-collection.ts    (AJV against schemas/, shared with scripts/lib/validate-data.mjs)
```

`lib/read-merge-write.ts` provides a generic, retry-safe read → merge → validate → write helper
(re-reads and re-applies the merge function on a GitHub 409 from a stale `sha`, up to 3 attempts).
It takes `readFile`/`writeFile` as required injected functions rather than defaulting to a
specific storage binding, so callers wire their own.

`lib/ingest-token.ts` exists only because tests inherited from the deleted Netlify admin exercise
it — it implements a bearer-token auth model that has **no live caller** in the Worker. Don't wire
it into new routes; the live auth model is Basic-auth/session-cookie only.

## GitHub repo sync-check

`routes/admin/sync-github.ts` — lets the admin dashboard find public, non-fork GitHub repos (under
`GITHUB_USERNAME`, falling back to the content repo's owner) not yet represented in
`personal-projects.json.enc`, sync them in individually or all at once, or mark them to skip.

- **Filtering**: GitHub's own `private === false && fork === false` booleans; no other filters.
- **Sync-all**: one `readMergeWriteWithRetry` cycle *per repo* — N repos synced = N separate
  commits (or N PRs under `ADMIN_GITHUB_WRITE_MODE=pr`), chosen deliberately for failure isolation
  over a single batched write.
- **Skip list**: `sync_skip_list` D1 table (`repo_url` PK, `reason`, `skipped_at`) — see
  `migrations/0003_sync_skip_list.sql`. `DELETE /api/admin/skip-repo` takes `repo_url` as a query
  param, not a JSON body, to survive proxies that strip DELETE bodies.
- **Rate limits**: the 2 read-only endpoints (`unsynced-repos`, `skip-list`) share the `'read'`
  category (60/min, since dashboard loads hit them); the 3 mutating endpoints
  (`sync-github-repos`, `skip-repo` POST/DELETE) use a dedicated `'sync'` category (5/min).

## D1 usage

Binding `DB` → database `cms-db` (`packages/api/wrangler.jsonc`). Used for dynamic,
non-git-backed state — feature flags, contact submissions, audit logs, conversations, comments,
likes, todos (see [DATA-API.md](./DATA-API.md)), and now `sync_skip_list`. This is deliberately
separate from the encrypted git-backed collections: D1 is for things that change too often or are
too write-heavy to live as versioned JSON files.

## What's intentionally not here

- No Netlify anything — deploy is `wrangler deploy` for the Worker; the static Vite build is a
  separate, independent artifact.
- No bearer/ingest-token auth path live in the Worker (see `lib/ingest-token.ts` note above).
- No image proxying in the Worker — `/images/*` are static assets served by whatever hosts `dist/`,
  not decrypted or transformed by the Worker.
