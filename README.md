# Static Encrypted CMS

Encrypted **file-based content vault** for [jovylle.com](https://jovylle.com) and related sites. Git stores ciphertext; the CDN serves a filtered public JSON slice. This repo is the **only supported production content host** (`https://content.jovylle.com`).

**Successor to** [`my-json-database`](../my-json-database) (legacy archive — do not use as a runtime API).

---

## For new conversations (read this first)

If you are an agent or picking this up cold, here is the mental model:

| Question | Answer |
|----------|--------|
| **What is this?** | A schema-backed JSON file database. Tables live as `.json` files under `data/source/` (local only). Git commits `data/encrypted/*.json.enc`. Netlify build exports public JSON to the CDN. |
| **Source of truth?** | `data/source/` on the editor's machine — **not** Supabase, **not** Decap (removed), **not** pocket.uft1.com. |
| **What gets committed?** | Only `data/encrypted/**/*.json.enc` (+ code, images). Never commit `data/source/`, `public/data/`, or `.env`. |
| **How to edit?** | `data:decrypt` → edit JSON → `data:save` (validate + encrypt) → `git push`. |
| **How do apps read content?** | `fetch('https://content.jovylle.com/data/...')` — no decrypt key in browsers. |
| **Strictest schema?** | `personal-projects.json` — see [Personal projects shape](#personal-projects-shape) below. |
| **Decap CMS?** | **Removed.** Do not add `public/admin/` or netlify-cms back without explicit user request. |
| **Supabase?** | **Migration import only** (`data:import-personal-projects-from-supabase` + CSV export). Ongoing edits are files in `data/source/`. |

Deep dives: [DATABASE.md](docs/DATABASE.md) · [DATA-ENCRYPTION.md](docs/DATA-ENCRYPTION.md) · [ECOSYSTEM.md](docs/ECOSYSTEM.md) · [schemas/](schemas/)

---

## Philosophy

- **Git is the database** — durable state is encrypted JSON in the repo.
- **Plaintext is local** — `data/source/` is gitignored; decrypt to edit, encrypt to commit.
- **CDN is the read replica** — `data:export` builds the public slice (no drafts / no `private: true`).
- **Schemas enforce shape** — `npm run data:validate`; `data:encrypt` **fails closed** if validation fails.
- **Key never in the client** — `CONTENT_DECRYPT_KEY` only in `.env` / Netlify env / CI secrets.

---

## Repository layout

```text
static-encrypted-cms/
├── data/
│   ├── source/              # Plaintext JSON (GITIGNORED) — editorial source of truth
│   │   ├── personal-projects.json
│   │   ├── projects.json
│   │   ├── highlights.json
│   │   ├── profile.json
│   │   ├── resume.json
│   │   └── blogs/*.json
│   └── encrypted/             # AES-256-GCM ciphertext (COMMITTED)
│       ├── *.json.enc
│       └── blogs/*.json.enc
├── schemas/                   # JSON Schema + manifest.collections.json
├── scripts/                   # encrypt, decrypt, export, validate, imports
│   └── lib/                   # crypto, paths, normalize, validate helpers
├── public/
│   ├── data/                # Generated public slice (GITIGNORED); built by data:export
│   └── images/              # Static assets (thumbnails, blog images)
├── src/                       # Minimal Vue vault preview UI (dev only)
├── docs/                      # DATABASE, encryption, ecosystem, future admin
└── .github/workflows/         # Portfolio rebuild hook on encrypted content push
```

---

## Data flow

```text
  EDIT (local)                    COMMIT (git)                 SERVE (CDN)
  ────────────                    ────────────                 ───────────

  data/source/*.json              data/encrypted/*.json.enc      content.jovylle.com
        │                                  │                         /data/*.json
        │  npm run data:validate           │  git push master          /images/*
        │  npm run data:encrypt            │  Netlify build
        └──────────────────────────────────┴── data:export ──────────────┘
```

1. **Decrypt** — `npm run data:decrypt` writes `data/source/` from committed ciphertext.
2. **Edit** — Change JSON (IDE, scripts, future content-admin repo).
3. **Validate + encrypt** — `npm run data:save` (or `data:validate` then `data:encrypt`).
4. **Commit** — `git add data/encrypted` (and any code/images); push.
5. **Deploy** — Netlify decrypts at build, runs `data:export`, ships `dist/data/`.
6. **Consumers** — Portfolio and other sites fetch fresh JSON from the CDN.

---

## Collections (file database tables)

Registry: [`schemas/manifest.collections.json`](schemas/manifest.collections.json)

| Collection | Source file | Schema | Public export |
|------------|-------------|--------|----------------|
| Personal projects | `data/source/personal-projects.json` | `schemas/personal-projects.schema.json` | Filtered + sorted by `priority_score` ↓ |
| Publish controls | `data/source/publish-controls.json` | `schemas/publish-controls.schema.json` | Internal export switches (not public) |
| Projects (case studies) | `data/source/projects.json` | `schemas/projects.schema.json` | Drops `draft` / `private: true` |
| Highlights | `data/source/highlights.json` | `schemas/highlights.schema.json` | Full file |
| Profile | `data/source/profile.json` | `schemas/profile.schema.json` | Full file |
| Resume | `data/source/resume.json` | `schemas/resume.schema.json` | Full file |
| Blogs | `data/source/blogs/{slug}.json` | *(no root schema yet)* | Per-post; drops draft frontmatter |

Blogs are encrypted and exported but not yet in the manifest validator list.

---

## Personal projects shape

**Canonical schema:** [`schemas/personal-projects.schema.json`](schemas/personal-projects.schema.json)

This is the most strictly regulated collection. It replaced legacy Decap / GitHub-sync fields.

### Required fields (per project)

`title`, `description`, `repo`, `updated_at`, `slug`, `status`, `private`, `fav`, `priority_score`, `tech`, `links`, `thumbnail`

### Optional

`language` — usually `tech.join(', ')` for display

### Do not use (removed legacy keys)

`stars`, `showcase`, `netlify_live`, `netlify_status`, `category`, `name`, `live` as separate host fields

Use **`links`** instead of Netlify-specific keys:

```json
{
  "title": "SFL Digging Assistant",
  "description": "Daily 300 Visitors. d1g.uk is a fast, free, and visual tool…",
  "repo": "https://github.com/jovylle/sfl-crab",
  "updated_at": "2026-02-28T00:35:15Z",
  "slug": "sfl-crab",
  "status": "published",
  "private": false,
  "fav": false,
  "priority_score": 250,
  "tech": ["JS", "Vue", "Nuxt", "Serverless"],
  "links": [
    { "label": "Repo", "url": "https://github.com/jovylle/sfl-crab" },
    { "label": "Live", "url": "http://d1g.uk/" },
    { "label": "User Feedbacks", "url": "https://d1g.uk/feedbacks" }
  ],
  "thumbnail": "https://content.jovylle.com/images/post/sfl-crab.png",
  "language": "JS, Vue, Nuxt, Serverless"
}
```

- **`priority_score`** — integer `0`–`1000`; higher appears first on CDN export (default `100`).
- **`status`** — `"published"` \| `"draft"` (drafts stay in encrypted git, stripped from CDN).
- **`private`** — `true` items are stripped from CDN export.

Normalize / migrate legacy rows:

```bash
npm run data:import-personal-projects-from-supabase -- path/to/portfolio_projects_rows.csv
npm run data:normalize-personal-projects
npm run data:validate
```

Implementation: `scripts/lib/personal-project-normalize.mjs` (Node) and `scripts/lib/personal_project_shape.py` (Python imports).

---

## Commands

| Script | When to use |
|--------|-------------|
| `data:decrypt` | Pull latest from git → get editable `data/source/` |
| `data:validate` | Check all manifest collections against JSON Schema |
| `data:encrypt` | Validate (required), then write changed files to `data/encrypted/` (skips unchanged; use `--force` to re-encrypt all) |
| **`data:save`** | **`data:validate` + `data:encrypt`** — use before every commit |
| `data:export` | Decrypt ciphertext → filter → `public/data/` (runs on `dev` / `build`) |
| `data:migrate-from-seed` | **One-time** copy from `../my-json-database/public/data/` |
| `data:import-personal-projects-from-supabase` | **Migration** from Supabase CSV + seed gap-fill |
| `data:normalize-personal-projects` | Strip legacy keys; enforce canonical project shape |
| `data:sync-github-personal-projects` | Pull new public GitHub repos and append valid project rows |
| `data:fix-image-urls` | Rewrite `/images/...` and `pocket.uft1.com` → CDN URLs in source |
| `data:sync-images-from-seed` | Copy images from my-json-database |
| `dev` / `build` | Preview UI; `predev` / `prebuild` run `data:export` |

---

## Edit workflow (daily)

```bash
npm run data:decrypt
# edit files under data/source/
npm run data:save
git add data/encrypted public/images   # only what changed; never add data/source/
git commit -m "content: …"
git push
```

`.gitignore` excludes `data/source/`, `public/data/`, `.env` — a normal `git add .` should only pick ciphertext and safe paths. **Always run `data:save` before commit** so encrypted blobs match plaintext.

---

## Quick start (fresh clone)

```bash
npm install

# One-time: seed from legacy repo (optional)
npm run data:migrate-from-seed

# Key (min 16 chars) — never commit
echo "CONTENT_DECRYPT_KEY=$(openssl rand -base64 32)" > .env

# If data/encrypted/ exists in git:
npm run data:decrypt

# After edits:
npm run data:save
npm run dev    # http://localhost:5173 — previews public/data/
```

---

## Deploy (Netlify — this vault)

- Env: `CONTENT_DECRYPT_KEY`
- Build: `npm run build` → `prebuild` runs `data:export` → Vite → `dist/data/`
- Domain: **https://content.jovylle.com**

---

## Consuming content (portfolio & other apps)

**Only supported production base URL:**

```text
https://content.jovylle.com
```

```js
const BASE = 'https://content.jovylle.com';
const { projects } = await fetch(`${BASE}/data/personal-projects.json`).then((r) => r.json());
// projects are sorted by priority_score desc, then updated_at
```

### Public endpoints (after build)

| URL | Content |
|-----|---------|
| `/data/personal-projects.json` | Curated portfolio repos |
| `/data/projects.json` | Case-study style projects |
| `/data/highlights.json` | Career highlights |
| `/data/profile.json` | Site profile blurb |
| `/data/resume.json` | Resume JSON |
| `/data/blogs/index.json` | Blog list |
| `/data/blogs/{slug}.json` | Single post |
| `/images/post/…` | Thumbnails and blog media |

Export rules: omit `status: "draft"`, `private: true`, and blog frontmatter `draft: true`.
Collection gate: if `publish-controls.personal_projects_public` is `false`, `/data/personal-projects.json` is not exported.

## Admin v1 (password-protected)

Accessible at `/admin/` on any host serving the admin HTML (currently `content.jovylle.com`).

The admin panel calls the **Cloudflare Worker API** at `/api/admin/*`
(routes migrated from Netlify Functions — see `packages/api/src/routes/admin/`).

Auth is handled server-side by the Worker:

- Browser never receives `CONTENT_DECRYPT_KEY`
- Password is verified from `ADMIN_PASSWORD` (plain env var; hash fallback supported via `ADMIN_PASSWORD_HASH`)
- Session uses signed HttpOnly cookie
- Mutations write encrypted files back to GitHub via `GITHUB_TOKEN`

Worker URL: `content-api.jovyllebermudez.workers.dev`
Admin endpoints: `/api/admin/login`, `/api/admin/session`, `/api/admin/logout`, `/api/admin/projects`, `/api/admin/collections`, `/api/admin/collection/:key`, `/api/admin/blogs`, `/api/admin/blogs/:slug`, `/api/admin/notifications`, `/api/admin/notifications/:slug`, `/api/admin/project-visibility`, `/api/admin/collection-visibility`, `/api/admin/sort-personal-projects`

Optional: generate `ADMIN_PASSWORD_HASH` fallback:

```bash
npm run admin:hash-password -- "your-admin-password"
```

### Deprecated — do not use in new code

| Source | Status |
|--------|--------|
| `https://pocket.uft1.com` | Legacy my-json-database host |
| `my-json-database` repo as live API | Archive; local seed import only |
| Decap CMS `/admin/` | Removed from this repo |
| Supabase as ongoing editor | CSV import for migration only |

---

## Portfolio rebuild chain

When `data/encrypted/**` changes on `master`, [`.github/workflows/trigger-portfolio-rebuild.yml`](.github/workflows/trigger-portfolio-rebuild.yml) POSTs the portfolio Netlify build hook.

**GitHub secret:** `PORTFOLIO_NETLIFY_BUILD_HOOK` (full hook URL — never commit).

Portfolio may build before this vault finishes deploying; if data looks stale, chain vault deploy-success → portfolio hook or add delay.

---

## Automated GitHub repo sync

Daily sync can append newly created public repositories to `personal-projects`:

- Workflow: [`.github/workflows/sync-new-github-personal-projects.yml`](.github/workflows/sync-new-github-personal-projects.yml)
- Schedule: `18:40 UTC` daily (intentionally not `00:00 UTC`)
- Required secret: `CONTENT_DECRYPT_KEY`

The sync uses repository metadata plus README extraction:

- Adds only public, non-fork repos not already listed.
- Builds `description` from GitHub description, then README fallback.
- Skips repos when metadata is too thin (`MIN_DESCRIPTION_LENGTH`, default `24` chars), so weak entries are not auto-published.

---

## Related repos & future work

| Repo | Role |
|------|------|
| **static-encrypted-cms** (this) | Encrypt, schemas, CDN vault |
| **my-json-database** | Legacy; seed/migration reference only |
| **content-admin** (planned) | Separate UI for batch edits — see [FUTURE-ADMIN.md](docs/FUTURE-ADMIN.md) |
| Portfolio site (external) | Consumes `content.jovylle.com/data/*`; must use `priority_score`, `tech`, `links` |

---

## Docs index

| Doc | Purpose |
|-----|---------|
| [DATABASE.md](docs/DATABASE.md) | Official file-database model |
| [DATA-ENCRYPTION.md](docs/DATA-ENCRYPTION.md) | `.enc` format, key handling, lost-key warning |
| [ECOSYSTEM.md](docs/ECOSYSTEM.md) | Tiers: public CDN, build profiles, future API |
| [FUTURE-ADMIN.md](docs/FUTURE-ADMIN.md) | Planned content-admin repo |
| [CODEBASE-LEARNINGS.md](docs/CODEBASE-LEARNINGS.md) | Full agent onboarding — architecture, encryption, admin, schemas, rules |
| [NEW-PROJECT-static-encrypted-cms-PROMPT.md](docs/NEW-PROJECT-static-encrypted-cms-PROMPT.md) | Full agent spec (may lag README; prefer this file + DATABASE.md) |
| [schemas/README.md](schemas/README.md) | Schema files and validation |

---

## Common agent tasks

| Task | Steps |
|------|--------|
| Add/edit a personal project | Edit `data/source/personal-projects.json` → match schema → `data:save` |
| Import from Supabase CSV | `data:import-personal-projects-from-supabase -- path.csv` → `data:normalize-personal-projects` → `data:save` |
| Fix broken image URLs | `data:fix-image-urls` → `data:save` |
| Check shape before push | `npm run data:validate` |
| Preview public slice locally | `npm run dev` (after `data:export` or `build`) |

**Do not** reintroduce `stars`, `showcase`, or `netlify_*` on personal projects. **Do not** commit plaintext or the decrypt key.
