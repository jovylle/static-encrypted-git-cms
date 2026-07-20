# Ecosystem — vault as content center

`static-encrypted-cms` is the **encrypted source of truth**. Other apps consume content in one of three tiers.

## Personal projects data flow

| Layer | Role |
|-------|------|
| **`data/source/personal-projects.json`** | Editorial source of truth (schemas in `schemas/`) |
| **Supabase CSV import** | One-time migration only (`data:import-personal-projects-from-supabase`) |
| **Encrypted git + CDN** | `data:encrypt` → `content.jovylle.com/data/personal-projects.json` |

```bash
npm run data:decrypt
# edit data/source/personal-projects.json
npm run data:save
git push
```

Public export sorts by `priority_score` (desc), then `updated_at`.

## Canonical URL

Production consumers must use:

```text
https://content.jovylle.com
```

Example: `https://content.jovylle.com/data/personal-projects.json`

Static images (thumbnails, blog media) live on the same host:

```text
https://content.jovylle.com/images/gitprofile.png
https://content.jovylle.com/images/post/sfl-crab.png
```

Exported JSON rewrites legacy `/images/...` and `pocket.uft1.com` paths to those URLs automatically.

## Tier 1: Public static JSON (default)

Fetch public endpoints from the vault CDN:

```js
const BASE = 'https://content.jovylle.com';
const projects = await fetch(`${BASE}/data/projects.json`).then((r) => r.json());
```

No API key. Only data that passed `data:export` (no drafts, no `private: true`).

### Deprecated sources (do not use in apps)

| URL / repo | Status |
|------------|--------|
| `pocket.uft1.com` | Legacy `my-json-database` host — migration reference only |
| `my-json-database` repo | Unchanged archive; use local seed scripts to import into this vault once |

New sites and portfolio builds should **not** `fetch` pocket. After migration, all reads go to `content.jovylle.com`.

### Portfolio rebuild chain

1. Edit → `data:encrypt` → push `master` on this vault (`data/encrypted/**`).
2. Netlify builds **content.jovylle.com** from this repo.
3. GitHub Actions ([`trigger-portfolio-rebuild.yml`](../.github/workflows/trigger-portfolio-rebuild.yml)) POSTs the portfolio Netlify build hook (secret `PORTFOLIO_NETLIFY_BUILD_HOOK`).
4. Portfolio site rebuilds and fetches fresh public JSON from the CDN.

Store the hook URL only in GitHub Actions secrets, never in git or `.env`.

## Tier 2: Per-site build profile (static, broader slice)

A satellite repo:

1. Submodule or clone this vault
2. Runs `data:export` (future: `--profile site-name`) in **its** CI with `CONTENT_DECRYPT_KEY`
3. Deploys generated JSON to **its** URL (optionally behind Netlify password / team access)

The master key stays in CI only; the browser never decrypts.

## Tier 3: Admin API (Cloudflare Workers — migrated)

Admin endpoints run as Cloudflare Workers (migrated from Netlify Functions).
Same Worker that hosts Tier 4; routes prefixed `/api/admin/`.

Auth + rate limiting + CORS middleware shared with Tier 4.

Admin endpoints:

- `/api/admin/login`, `/api/admin/session`, `/api/admin/logout`
- `/api/admin/projects`
- `/api/admin/collections` — list editable collections
- `/api/admin/collection/:key` — GET/POST single collection file
- `/api/admin/blogs` — list blog posts
- `/api/admin/blogs/:slug` — GET/POST/DELETE single blog post
- `/api/admin/notifications` — list notification bundles
- `/api/admin/notifications/:slug` — GET/POST/DELETE single bundle
- `/api/admin/project-visibility` — toggle single project status
- `/api/admin/collection-visibility` — toggle collection publish state
- `/api/admin/sort-personal-projects` — sort by GitHub repo creation date

Behavior:

- Worker decrypts and mutates encrypted JSON server-side only.
- Writeback goes to GitHub (`data/encrypted/*.json.enc`) using `GITHUB_TOKEN`.
- `ADMIN_GITHUB_WRITE_MODE=commit|pr` controls direct commit vs branch+PR flow.
- Browser never receives `CONTENT_DECRYPT_KEY`.
- `nodejs_compat` compatibility flag enables Node.js crypto APIs (scrypt, AES-256-GCM, HMAC).

Collection-level visibility is controlled by encrypted `publish-controls.json.enc`:

```json
{ "personal_projects_public": true }
```

When false, `data:export` skips publishing `/data/personal-projects.json`.

## Tier 4: Dynamic Data API (Cloudflare Workers + D1)

Low-latency, high-write dynamic endpoints for non-static content. Deployed to Cloudflare Workers
with a remote D1 database in APAC region.

### Endpoints

All endpoints live under `https://content-api.jovyllebermudez.workers.dev/api/`.

| Category | Method | Path | Auth | Description |
|----------|--------|------|------|-------------|
| **Health** | GET | `/api/health` | — | Readiness check |
| **Feature flags** | GET | `/api/feature-flags` | — | List all flags |
| | GET | `/api/feature-flags/:key` | — | Get single flag |
| | POST | `/api/feature-flags` | Admin | Create flag |
| | PUT | `/api/feature-flags/:key` | Admin | Update flag |
| | DELETE | `/api/feature-flags/:key` | Admin | Delete flag |
| **Contacts** | POST | `/api/contacts` | — | Submit contact form |
| | GET | `/api/contacts` | Admin | List submissions |
| | GET | `/api/contacts/:id` | Admin | Get submission |
| | PUT | `/api/contacts/:id` | Admin | Update status |
| | DELETE | `/api/contacts/:id` | Admin | Delete |
| **Audit logs** | GET | `/api/audit-logs` | Admin | List audit entries |
| **Conversations** | GET | `/api/conversations` | — | List conversations |
| | POST | `/api/conversations` | — | Start conversation |
| | GET | `/api/conversations/:id` | — | Get with messages |
| | PUT | `/api/conversations/:id` | Admin | Update title |
| | DELETE | `/api/conversations/:id` | Admin | Delete |
| | POST | `/api/conversations/:id/messages` | — | Add message |
| **Comments** | GET | `/api/comments?target_type=&target_id=` | — | List approved |
| | POST | `/api/comments` | — | Submit (pending) |
| | GET | `/api/comments/all` | Admin | Moderation queue |
| | PUT | `/api/comments/:id` | Admin | Approve/reject |
| | DELETE | `/api/comments/:id` | Admin | Delete |
| **Likes** | POST | `/api/likes/toggle` | — | Toggle like (by visitor) |
| | GET | `/api/likes/count?target_type=&target_id=` | — | Get count |
| **To-dos** | GET | `/api/todos` | Admin | List all todos |
| | POST | `/api/todos` | Admin | Create todo |
| | GET | `/api/todos/:id` | Admin | Get single todo |
| | PUT | `/api/todos/:id` | Admin | Update todo |
| | DELETE | `/api/todos/:id` | Admin | Delete todo |

### Auth

- **Public routes**: no auth required.
- **Admin routes**: Basic auth (`Authorization: Basic base64(admin:<password>)`) or session cookie (`admin_session=...`).
- Password checked via timing-safe comparison.
- Rate limiting: 10/min auth, 60/min read, 30/min write (per-IP in-memory).

### Audit logging

Admin write operations (create/update/delete feature flags, contacts, conversations, comments,
likes, todos) automatically record to `audit_logs` with actor, action, target, and metadata (before/after state).

### Development

```bash
cd packages/api
npm run dev        # local dev with wrangler
npm test           # vitest with isolated D1 per test
```

## What does not belong here

- API keys, passwords, PII — use env / secrets manager, not JSON in git
- Full portfolio UI — lives in consumer apps; this repo is vault + minimal proof UI

## Future admin (separate repo)

Planned replacement for Decap: a technical, batch-friendly panel in its **own** git repo. It edits the same `data/source/` shapes, then relies on this vault for encrypt → git → CDN.

See [FUTURE-ADMIN.md](./FUTURE-ADMIN.md).

## Legacy

[`my-json-database`](../my-json-database) and **pocket.uft1.com** are retired as content APIs. This vault (`content.jovylle.com`) is the only supported CDN for consumer apps.
