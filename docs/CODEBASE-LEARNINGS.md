# Codebase Learnings

## Overview

**static-encrypted-cms** is a file-based, encrypted content vault powering [jovylle.com](https://jovylle.com). Git stores AES-256-GCM ciphertext (`data/encrypted/*.json.enc`); the CDN (`content.jovylle.com`) serves a filtered public JSON slice. There is no database server — JSON files are the database.

---

## Data Model

| Layer | Path | Git? | Purpose |
|-------|------|------|---------|
| Plaintext source | `data/source/*.json` | **No** (gitignored) | Editorial truth — edit here |
| Encrypted vault | `data/encrypted/*.json.enc` | **Yes** | Durable storage |
| Public export | `public/data/*.json` | No (gitignored) | CDN-ready slice |
| Schemas | `schemas/*.schema.json` | Yes | Validation contracts |

Collections are registered in `schemas/manifest.collections.json` — each maps `source → schema → export rules`.

---

## Encryption Layer (`scripts/lib/content-crypto.mjs`)

- **Algorithm:** AES-256-GCM (Node `crypto`)
- **Key derivation:** `scryptSync(CONTENT_DECRYPT_KEY, 'static-encrypted-cms-content-v1', 32)`
- **IV:** 12 random bytes per file
- **Format:** `{ v: 1, iv: "<base64>", tag: "<base64>", data: "<base64 ciphertext>" }`
- **Key source:** `CONTENT_DECRYPT_KEY` env var (min 16 chars from `.env` / Netlify env / CI secrets)
- **Key never in browsers** — CDN serves already-decrypted public JSON

## Data Flow (Encrypt Path)

```
data/source/*.json
    │ npm run data:validate     ← validates against JSON Schema (Ajv 2020)
    │ npm run data:encrypt      ← only changed files (IV per file); --force to re-encrypt all
    ▼
data/encrypted/*.json.enc
    │ git add → git push
    │ Netlify build → npm run data:export
    ▼
content.jovylle.com/data/*.json   (public, no auth)
```

## Data Flow (Decrypt / Edit Path)

```
data/encrypted/*.json.enc
    │ npm run data:decrypt
    ▼
data/source/*.json
    │ edit → npm run data:save (= validate + encrypt)
    ▼
data/encrypted/*.json.enc  →  git commit
```

## Public Export (`scripts/data-export.mjs`)

Decrypts ciphertext → applies filters → writes to `public/data/` and `public/notifications/`:

| Collection | Filter | Sort |
|------------|--------|------|
| `personal-projects.json` | Drops `draft`/`private` items | `priority_score` desc → `updated_at` desc |
| `projects.json` | Drops `draft`/`private` items | None |
| `highlights`, `profile`, `resume` | Full export | None |
| `blogs/*.json` | Drops drafts + frontmatter `draft: true` | None |
| `notifications/*.json` | Drops expired, drafts, private | Sorted by date desc |
| `publish-controls.json` | **Not exported** (encrypted only) | N/A |

Asset URLs are rewritten (`/images/...` → `https://content.jovylle.com/images/...`, `pocket.uft1.com` → CDN).

## Publish Controls (`scripts/lib/publish-controls.mjs`)

`data/source/publish-controls.json` (encrypted as `publish-controls.json.enc`) controls per-collection visibility:

```json
{
  "personal_projects_public": true,
  "collections": {
    "blogs": "public",
    "notifications": "public"
  }
}
```

Each collection defaults to `"public"`. When set to `"draft"` or `"private"`, `data:export` skips that collection entirely. Controls and collections IDs include: `personal-projects`, `projects`, `highlights`, `profile`, `resume`, `blogs`, `notifications`, `homepage`, `social`, `uses`.

## Admin API (Cloudflare Workers — migrated from Netlify Functions)

Admin functions were migrated from `netlify/functions/` to the Cloudflare Worker at `packages/api/src/routes/admin/`. Routes prefixed `/api/admin/`. The original Netlify Functions remain in the repo as reference but are no longer deployed — `content.jovylle.com` routes through Cloudflare CDN which blocked POST requests to `/.netlify/functions/*`.

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/admin/login` | POST | Password auth → HttpOnly signed session cookie |
| `/api/admin/session` | GET | Verify current session |
| `/api/admin/logout` | POST | Clear session |
| `/api/admin/projects` | GET | Dashboard summary (projects, notifications, blog count) |
| `/api/admin/project-visibility` | POST | Toggle `private`/`status` on single project |
| `/api/admin/collection-visibility` | POST | Toggle publish-controls for a collection |
| `/api/admin/collections` | GET | List editable collections |
| `/api/admin/collection/:key` | GET/POST | Read/Update single collection file |
| `/api/admin/blogs` | GET | List blog posts |
| `/api/admin/blogs/:slug` | GET/POST/DELETE | Read/Update/Delete single blog post |
| `/api/admin/notifications` | GET | List notification bundles |
| `/api/admin/notifications/:slug` | GET/POST/DELETE | Read/Update/Delete single notification bundle |
| `/api/admin/sort-personal-projects` | POST | Sort projects by GitHub repo creation date |

**Security model:**
- `ADMIN_PASSWORD` (plain env var) or `ADMIN_PASSWORD_HASH` (scrypt-hashed fallback)
- Session tokens signed with HMAC-SHA256 via Web Crypto API (or Node crypto with `nodejs_compat`)
- `GITHUB_TOKEN` for writeback — decrypts → mutates → encrypts → commits to GitHub
- `CONTENT_DECRYPT_KEY` for AES-256-GCM encryption via `node:crypto` (nodejs_compat)
- Write mode: `ADMIN_GITHUB_WRITE_MODE=commit|pr`
- Rate limiting: 10/min auth, 60/min read, 30/min write (shared with Tier 4 middleware)
- Browser **never** receives `CONTENT_DECRYPT_KEY`
- Admin panel at `/admin/` calls the Worker URL directly, bypassing Cloudflare CDN proxy

## Personal Projects (`schemas/personal-projects.schema.json`)

The most strictly regulated collection. Required fields: `title`, `description`, `repo`, `updated_at`, `slug`, `status`, `private`, `fav`, `priority_score`, `tech`, `links`.

Legacy keys removed via `scripts/lib/personal-project-normalize.mjs`: `stars`, `showcase`, `netlify_live`, `netlify_status`, `category`, `name`, `live`.

The normalization module deduplicates by repo URL, strips legacy fields, normalizes dates, parses `tech` (array or comma-separated string), and builds `links` array.

## Scripts & Commands (`package.json`)

| Command | Script | Description |
|---------|--------|-------------|
| `dev` | Vite dev server | Pre-run: `data:export` |
| `build` | Vite build | Generates indices, then builds |
| `data:decrypt` | `scripts/data-decrypt.mjs` | `.enc` → `data/source/` |
| `data:encrypt` | `scripts/data-encrypt.mjs` | Validate + write `.enc` (skips unchanged) |
| `data:export` | `scripts/data-export.mjs` | Decrypt → filter → `public/data/` |
| `data:validate` | `scripts/data-validate.mjs` | JSON Schema check all collections |
| `data:save` | validate + encrypt | **Use before every commit** |
| `data:sync-github-personal-projects` | Fetch new public repos via GitHub API | Daily cron |
| `data:normalize-personal-projects` | Strip legacy keys from source | After Supabase import |
| `generate-indices` | Blog + notification index.json builders | Runs during `build` |

### Helper Libraries (`scripts/lib/`)

| File | Role |
|------|------|
| `content-crypto.mjs` | AES-256-GCM encrypt/decrypt with scrypt key derivation |
| `data-paths.mjs` | Directory constants, path converters, file listing |
| `data-io.mjs` | File I/O utilities (JSON read/write, .env loader, mkdir -p) |
| `encrypt-sync.mjs` | Single-file encrypt with change detection (compares plaintexts) |
| `public-filter.mjs` | Item visibility filters, frontmatter parser, notification bundling |
| `validate-data.mjs` | Ajv-based JSON Schema validation against manifest |
| `asset-urls.mjs` | Rewrites `/images/` & `pocket.uft1.com` → CDN URLs |
| `publish-controls.mjs` | Collection visibility logic, defaults all collections to public |
| `personal-project-normalize.mjs` | Canonical shape: dedupe, strip legacy, parse tech/links |

### Admin Library (`netlify/functions/lib/`)

| File | Role |
|------|------|
| `admin-auth.mjs` | Password verification, session token create/verify |
| `http.mjs` | HTTP response helpers (JSON, errors, CORS) |
| `encrypted-content-store.mjs` | Decrypt → edit → encrypt → commit |
| `github-content.mjs` | GitHub API write operations |
| `validate-collection.mjs` | In-memory schema validation for mutations |
| `visibility-mutators.mjs` | Toggle project/collection visibility |
| `rate-limit.mjs` | In-memory rate limiter |

## GitHub Actions

1. **`sync-new-github-personal-projects.yml`** — Daily cron (`18:40 UTC`): fetches new public repos from `jovylle` GitHub account, appends to `personal-projects` if description ≥ 24 chars and deduped by repo URL. Commits encrypted file directly.

2. **`sync-usage-metrics.yml`** — Syncs Cloudflare analytics (zone traffic data) to `public/data/usage-metrics.json`.

Portfolio trigger: when `data/encrypted/**` changes on `master`, `.github/workflows/trigger-portfolio-rebuild.yml` POSTs the portfolio Netlify build hook (secret `PORTFOLIO_NETLIFY_BUILD_HOOK`).

## Blog Posts (`data/source/blogs/{slug}.json`)

Each blog post is a JSON object with fields: `title`, `slug`, `date`, `status`, `private`, `tags`, `thumbnail`, `excerpt`, `body` (markdown with YAML frontmatter), `content`, `featured`, `author`. Frontmatter in `body` is parsed for `draft` flag and legacy title/date.

Export generates `public/data/blogs/index.json` by scanning all blog JSON files, extracting title/date from frontmatter, and sorting by date desc.

## Notifications (`data/source/notifications/{date}.json`)

Notification bundles are date-keyed JSON files, each containing a `notifications` array. Each notification has: `id`, `title`, `message`, `type` (info/success/warning/error/announcement), `tags`, `timestamp`, `persistent`, `status`, `private`, `date`, `expiresAt`, `link`.

Export filters by visibility + expiration, flattens across bundles deduped by ID, and generates `public/data/notifications.json` + individual files in `public/notifications/`.

## Frontend (Vite + Vue 3)

Minimal Vue 3 preview UI (`src/App.vue`) for browsing public data:
- Tabs for each collection endpoint
- Table view for arrays of objects
- K/V view for single objects
- Raw JSON expandable preview
- Search/filter across rows
- Home feed showing latest 5 blogs + 5 notifications

## Deploy (Netlify)

- Build: `npm run build` → `prebuild` runs `data:export` → Vite bundles → `dist/`
- Domain: `content.jovylle.com`
- Required env vars: `CONTENT_DECRYPT_KEY` (export at build time)
- CORS: `Access-Control-Allow-Origin: *` on `/data/*` and `/notifications/*`
- Edge cache: `Cache-Control: public, max-age=300`
- Includes `schemas/` in functions bundle for admin validation
- Admin functions use `ajv` + `ajv-formats` as external Node modules

## Templates

- `data/templates/blog-post.json` — Full blog post shape with placeholder content
- `data/templates/personal-project.json` — Personal project model fields
- `data/templates/notification.json` — Single notification model

## Immutable Rules

1. **Never commit** `data/source/`, `public/data/`, `.env`
2. **Never expose** `CONTENT_DECRYPT_KEY` to browsers
3. **Always run** `npm run data:save` before every git commit
4. **No** `stars`, `showcase`, `netlify_*` fields on personal projects — use `links` array
5. **No** Decap CMS or Supabase as ongoing editor — these are removed/migration-only
6. **Only supported CDN:** `https://content.jovylle.com`
7. **CI secrets:** `CONTENT_DECRYPT_KEY`, `GITHUB_TOKEN`, `PORTFOLIO_NETLIFY_BUILD_HOOK`
