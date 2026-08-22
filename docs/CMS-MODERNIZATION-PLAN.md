# CMS Modernization Plan

> **Status:** Phases 2, 3, 4 complete. Phase 1 code complete, deploy is a user action (pending CF token refresh).
> **Created:** 2026-07-26
> **Updated:** 2026-07-27
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

**Status:** Code changes complete and verified working (covered by Phase 2/3 test runs). Deploy is a user action — pending CF API token refresh.

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

**Status:** Complete. Implemented as `packages/api/src/routes/admin/sync-github.ts` (5 handlers),
migration `packages/api/migrations/0003_sync_skip_list.sql` (renumbered from the `0002` planned
below — `0002_scores.sql` already existed), additions to `github-repo-meta.ts`, `rate-limit.ts`,
`router.ts`, and `admin-html.ts`. Auth model note: this repo's live Worker auth is Basic-auth
header or session cookie only (`middleware/auth.ts`) — the "yes" in the endpoint table below means
"requires admin auth via that existing mechanism," not a separate ingest-token scheme. New tests
in `packages/api/test/sync-github.test.ts` (16 tests, all passing). Reviewed and verified: auth
gating, parameterized SQL, per-repo failure isolation, filter correctness, rate-limit category
assignment, and XSS-safety of the admin UI all checked out clean.

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

**Status:** Complete. `netlify.toml` and `netlify/functions/` deleted. `readMergeWriteWithRetry`
and the ingest-token test helpers were ported to TypeScript first (`packages/api/src/lib/
read-merge-write.ts`, `ingest-token.ts`) since tests still depended on the old `.mjs` logic; 5
test files repointed, 2 dead-handler-only test files deleted. `admin-html.ts`'s
`/.netlify/functions/` fallback replaced with a thrown error (unreachable in normal operation —
verified all real routes are mapped above it). `npm run test:admin` and `npm run build` both
pass. Reviewed independently — no issues found beyond one non-blocking `tsconfig.json` fix
(`allowImportingTsExtensions`), which was applied.

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

**Status:** Complete. `README.md`, `docs/ECOSYSTEM.md`, and `docs/CODEBASE-LEARNINGS.md` updated
to remove stale Netlify deploy references (Netlify field-name history and the legacy
`PORTFOLIO_NETLIFY_BUILD_HOOK` secret name are intentionally kept — they're accurate historical/
naming facts, not stale claims). `docs/ARCHITECTURE.md` created per the facts list below, corrected
against actual code where the original plan's assumptions didn't hold (see note there — no image
proxy route exists in the Worker; `/images/*` is served by whatever hosts the static `dist/`
build, not the Worker).

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
- ~~Images proxied from GitHub raw (or R2 if migrated)~~ — **not implemented**; no `/images/*`
  route exists in the Worker as of Phase 4. Images are served by whatever hosts the static
  `dist/` build. Left as an open item, not done in this pass.
- D1 used for skip list and interactive features (contacts, comments, etc.)
- No static build step required for content serving (root/blog/notification `/data/*` reads only —
  the static export path still exists for local preview and whatever deploys `dist/`)

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
