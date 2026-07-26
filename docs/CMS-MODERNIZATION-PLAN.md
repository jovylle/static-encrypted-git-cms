# CMS Modernization Plan

> **Status:** Phase 1 partially complete (routes added, pending deploy)
> **Created:** 2026-07-26
> **Goal:** Make content.jovylle.com a fast-updating, Cloudflare-only CMS with admin sync tooling

---

## Context

Netlify has been removed. The Worker (`content-api.jovyllebermudez.workers.dev`) now serves
content.jovylle.com. The admin panel at `/admin/` has full CRUD. But there are gaps:

- Only 5 of 13 encrypted collections are served publicly via `/data/`
- No way to detect or sync missing GitHub repos from the admin panel
- Dead Netlify config files remain in the repo
- Documentation still references Netlify

---

## Phase 1: Expand Worker `/data/` routes

**Status:** Code changes complete, pending deploy (CF API token needs refresh)

### What changed

`packages/api/src/routes/data-file.ts`:
- Added 4 missing root files to `ROOT_FILES`: `homepage.json`, `social.json`, `uses.json`, `fast-scores.json`
- Added `handleBlogIndex` — lists all published blog posts from `data/encrypted/blogs/`
- Added `handleBlogPost` — serves single blog post by slug
- Added `handleNotificationsIndex` — lists all notification bundles from `data/encrypted/notifications/`
- Added `handleNotificationBundle` — serves single notification bundle by slug

`packages/api/src/router.ts`:
- Added 4 new public routes (no auth required):
  - `GET /data/blogs/index.json`
  - `GET /data/blogs/{slug}.json`
  - `GET /data/notifications.json`
  - `GET /data/notifications/{slug}.json`

### Remaining (not yet done)

- **Images route:** `GET /images/*` — proxy to GitHub raw content so image URLs keep working
  - Option A: Worker proxies `https://raw.githubusercontent.com/jovylle/static-encrypted-git-cms/master/public/images/...`
  - Option B: Migrate images to Cloudflare R2 (better performance, more work)
  - Recommendation: Start with Option A, migrate to R2 later

### Deploy

```bash
cd packages/api
# Refresh CF API token first, then:
npx wrangler deploy
```

### Verification

After deploy, test these URLs:
- `https://content-api.jovyllebermudez.workers.dev/data/blogs/index.json`
- `https://content-api.jovyllebermudez.workers.dev/data/notifications.json`
- `https://content-api.jovyllebermudez.workers.dev/data/homepage.json`
- `https://content-api.jovyllebermudez.workers.dev/data/social.json`
- `https://content-api.jovyllebermudez.workers.dev/data/uses.json`

---

## Phase 2: GitHub sync check + notification + skip

**Status:** Not started

### Goal

Admin panel shows a banner when GitHub repos aren't in personal-projects.json.
User can sync individual repos or all, and skip repos they don't want to track.

### 2a. D1 migration for skip list

Create `packages/api/migrations/0002_sync_skip_list.sql`:

```sql
CREATE TABLE IF NOT EXISTS sync_skip_list (
  repo_url TEXT PRIMARY KEY,
  reason TEXT DEFAULT '',
  skipped_at TEXT DEFAULT (datetime('now'))
);
```

Run: `npm run db:init:remote`

### 2b. New Worker endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/api/admin/unsynced-repos` | yes | Check GitHub for repos not in personal-projects |
| `POST` | `/api/admin/sync-github-repos` | yes | Sync selected repos into personal-projects |
| `POST` | `/api/admin/skip-repo` | yes | Add repo to skip list |
| `DELETE` | `/api/admin/skip-repo` | yes | Remove from skip list |
| `GET` | `/api/admin/skip-list` | yes | List skipped repos |

#### `GET /api/admin/unsynced-repos` logic

1. Fetch repos from GitHub API: `GET /users/{owner}/repos?type=owner&per_page=100`
2. Filter to public, non-fork repos
3. Read current `personal-projects.json` from encrypted store
4. Build set of existing repo URLs (normalized)
5. Query D1 `sync_skip_list` for skipped URLs
6. Return repos not in existing set and not in skip list

Response shape:
```json
{
  "repos": [
    { "name": "repo-name", "url": "https://github.com/jovylle/repo-name", "description": "...", "language": "JS" }
  ],
  "totalCount": 42,
  "syncedCount": 38,
  "skippedCount": 2,
  "unsyncedCount": 2
}
```

#### `POST /api/admin/sync-github-repos` logic

1. Accept `{ repos: ["url1", "url2"] }` or `{ all: true }`
2. For each repo: fetch README, build project entry (reuse logic from `scripts/sync-github-personal-projects.mjs`)
3. Validate against personal-projects schema (AJV)
4. Encrypt and commit to GitHub via `writeEncryptedJsonFile`
5. Return `{ added: [...], skipped: [{ url, reason }] }`

#### Skip list endpoints

Simple D1 CRUD against `sync_skip_list` table.

### 2c. Rate limiting

Add new category to `packages/api/src/middleware/rate-limit.ts`:

```typescript
const RATE_LIMITS: Record<string, RateLimitConfig> = {
  auth: { windowMs: 60_000, maxRequests: 10 },
  read: { windowMs: 60_000, maxRequests: 60 },
  write: { windowMs: 60_000, maxRequests: 30 },
  sync: { windowMs: 60_000, maxRequests: 5 },  // NEW
};
```

Apply `sync` category to all sync/skip endpoints in `router.ts`.

### 2d. Admin panel UI changes

In `packages/api/src/routes/admin/admin-html.ts`:

**On dashboard load:**
- Call `GET /api/admin/unsynced-repos`
- If `repos.length > 0`, show banner: "⚠️ X GitHub repos not in personal-projects"
- Click banner → expandable list

**Per repo:**
- Repo name + description + language
- **[Sync]** button → syncs that one repo
- **[Skip]** button → adds to skip list, removes from list

**Bulk:**
- **[Sync All]** button → syncs all unsynced repos

**Debounce + rate limit handling:**
- Disable button immediately on click, show spinner
- If "Sync All", disable ALL sync buttons during request
- After successful sync: cooldown "Synced. Wait 10s..." countdown
- On 429 response: show toast "Too many requests. Wait Xs", auto-disable buttons for retry-after duration
- Optimistic skip: remove from list immediately, background request

**Skipped repos section (collapsed):**
- Show skipped repos with **[Unskip]** button
- Clicking unskip moves repo back to unsynced list

### 2e. New files to create

| File | Purpose |
|------|---------|
| `packages/api/migrations/0002_sync_skip_list.sql` | D1 table for skip list |
| `packages/api/src/routes/admin/sync-github.ts` | Sync + skip endpoint handlers |

### 2f. Files to modify

| File | Change |
|------|--------|
| `packages/api/src/middleware/rate-limit.ts` | Add `sync` category |
| `packages/api/src/router.ts` | Add sync/skip routes |
| `packages/api/src/routes/admin/admin-html.ts` | Add banner, list, debounce, toast |

### 2g. Reuse from existing sync script

The logic in `scripts/sync-github-personal-projects.mjs` should be extracted into a shared
module or directly ported to the Worker handler. Key functions to reuse:

- `normalizeRepoUrl()` — normalize GitHub URLs for comparison
- `buildProjectFromRepo()` — build project entry from GitHub API response
- `markdownToSummary()` — extract description from README
- `fetchReadmeSummary()` — fetch README via GitHub API

These can be copied into `packages/api/src/lib/github-repo-meta.ts` (which already exists
but only handles `created_at` fetching).

---

## Phase 3: Netlify cleanup

**Status:** Not started

### Files to delete

- `netlify.toml`
- `netlify/functions/` (entire directory — 13 old function files + lib/)

### Files to modify

- `packages/api/src/routes/admin/admin-html.ts` — remove `mapPath()` fallback to `/.netlify/functions/`
- `package.json` — check for any Netlify-related scripts

### Verification

- Run `npm run build` to ensure nothing breaks
- Check that the admin panel still works (no Netlify fallback calls)

---

## Phase 4: Documentation

**Status:** Not started

### Files to update

| File | Change |
|------|--------|
| `README.md` | Remove all Netlify references. Update deploy section to CF-only. Update data flow diagram. Update consuming content section. |
| `docs/ECOSYSTEM.md` | Remove Netlify tier. Document Worker as single content host. |
| `docs/CODEBASE-LEARNINGS.md` | Remove Netlify Functions references. Document sync-check feature. |
| `docs/ARCHITECTURE.md` (new) | Document CF Worker architecture, routes, admin panel, sync feature. |

### Key facts to document

- `content.jovylle.com` is served entirely by the Cloudflare Worker
- All `/data/*` routes are dynamic (decrypt from GitHub on every request, 5-min browser cache)
- Admin panel at `/admin/` with CRUD + sync-check
- Images proxied from GitHub raw (or R2 if migrated)
- D1 used for skip list and interactive features (contacts, comments, etc.)
- No static build step required for content serving

---

## Execution order

1. **Phase 1** — Deploy the expanded `/data/` routes (code ready, needs CF token refresh)
2. **Phase 3** — Netlify cleanup (quick, low risk)
3. **Phase 2** — Sync check + notification (main feature, most work)
4. **Phase 4** — Documentation (after everything is stable)

---

## Risks

| Risk | Mitigation |
|------|-----------|
| GitHub API rate limit on sync check | Cache repo list in D1 with TTL (1 hour) |
| Blog index requires decrypting 18 .enc files per request | Cache index in D1 or Worker KV with 5-min TTL |
| Images proxy adds latency | Acceptable for now; R2 migration later |
| Schema drift between embedded schemas and `schemas/` dir | Reuse same AJV schemas as existing admin |
| Spam clicking sync buttons | Rate limit (5/min) + UI debounce + cooldown |

---

## Architecture after completion

```
Browser
  │
  ├─ GET /data/*.json ──────► Worker ──► GitHub API (encrypted .enc)
  ├─ GET /data/blogs/* ──────► Worker ──► GitHub API (encrypted .enc)
  ├─ GET /data/notifications/* ► Worker ──► GitHub API (encrypted .enc)
  ├─ GET /images/* ───────────► Worker ──► GitHub raw content
  │
  ├─ GET /admin/ ─────────────► Worker (inline HTML)
  ├─ POST /api/admin/* ───────► Worker ──► GitHub API (write back)
  │
  └─ GET /api/admin/unsynced-repos ► Worker ──► GitHub API (compare)
```

No Netlify. No static build. No local decrypt/encrypt. Everything through the Worker.
