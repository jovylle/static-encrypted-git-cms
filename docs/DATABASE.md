# Database model

This repo has two databases: the **file-based vault** (encrypted JSON in git → CDN for static content)
and the **Cloudflare D1 database** (SQLite via Workers for dynamic data).

## File database (static content)

This repo **is** a file-based database. Git stores ciphertext; your machine holds plaintext while editing.

## Layers

```text
┌─────────────────────────────────────────────────────────────┐
│  Edit (local only, gitignored)                              │
│  data/source/**/*.json  ← schemas in schemas/*.schema.json   │
└──────────────────────────────┬──────────────────────────────┘
                               │ npm run data:validate
                               │ npm run data:encrypt
                               ▼
┌─────────────────────────────────────────────────────────────┐
│  Commit (git)                                               │
│  data/encrypted/**/*.json.enc                               │
└──────────────────────────────┬──────────────────────────────┘
                               │ npm run build (data:export)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│  Serve (CDN)                                                │
│  content.jovylle.com/data/*.json  (+ /images/)              │
└─────────────────────────────────────────────────────────────┘
```

## Source of truth

| What | Where |
|------|--------|
| **Canonical data** | `data/source/` on your machine |
| **Schema contract** | `schemas/` (JSON Schema) + `schemas/manifest.collections.json` |
| **Durable storage** | `data/encrypted/` in git |
| **Public read API** | Static JSON on `content.jovylle.com` |

**Not** the source of truth:

- Decap CMS (removed)
- Supabase `portfolio_projects` (migration import only — `data:import-personal-projects-from-supabase`)
- `my-json-database` / pocket.uft1.com (one-time seed — `data:migrate-from-seed`)

After migration, you edit JSON files (IDE, scripts, or a future admin panel), validate, encrypt, push.

## Collections

See [`schemas/manifest.collections.json`](../schemas/manifest.collections.json). Each entry maps a source file → schema → public export rules.

## Edit loop

```bash
npm run data:decrypt          # encrypted git → data/source/
# edit JSON under data/source/
npm run data:validate         # must pass before encrypt
npm run data:encrypt          # also runs validate (fails closed); skips unchanged .enc files
npm run data:encrypt -- --force   # re-encrypt every source file (new IVs on all blobs)
git add data/encrypted && git commit && git push
```

Shortcut: `npm run data:save` (= validate + encrypt).

## Personal projects

Shape: [`schemas/personal-projects.schema.json`](../schemas/personal-projects.schema.json).

- `priority_score` — sort weight (0–1000)
- `tech` — string array
- `links` — `{ label, url }[]` (use **Live**, not `netlify_*` hosts)
- No `stars`, `showcase`, `netlify_live`, `netlify_status`

Public export sorts by `priority_score` descending, then `updated_at`.

## Consumers

Apps `fetch` `https://content.jovylle.com/data/...` only. They never decrypt `.enc` and never need the master key.

---

## D1 database (dynamic data)

Cloudflare D1 (SQLite) stores high-write, low-latency dynamic data that doesn't belong in git:

| Table | Purpose |
|-------|---------|
| `feature_flags` | Toggle switches for frontend features |
| `contact_submissions` | Contact form messages |
| `conversations` | AI chat conversation threads |
| `messages` | Individual messages within conversations |
| `comments` | User comments with admin approval workflow |
| `likes` | Deduplicated likes per visitor per target |
| `todos` | Admin to-do items |
| `audit_logs` | Immutable audit trail of admin actions |

Schema: [`packages/api/migrations/0001_init.sql`](../packages/api/migrations/0001_init.sql)

### Architecture

```text
┌──────────────────────────────────────────────────────┐
│  Cloudflare Workers                                  │
│  (content-api.jovyllebermudez.workers.dev)           │
│  ┌────────────────────────────────────────────────┐  │
│  │  Router → Auth → Rate Limit → Handler → Response│  │
│  │  /api/* (dynamic) + /api/admin/* (CMS admin)    │  │
│  └────────────────────┬───────────────────────────┘  │
│                       │ D1 binding                    │
│  ┌────────────────────▼───────────────────────────┐  │
│  │  D1: cms-db (APAC region, HKG colo)            │  │
│  │  feature_flags, contacts, conversations,        │  │
│  │  messages, comments, likes, todos, audit_logs   │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

### Migration

```bash
cd packages/api
npx wrangler d1 migrations apply cms-db --remote  # deploy
npx wrangler d1 migrations apply cms-db --local   # dev
```

### Development

```bash
cd packages/api
npm run dev               # local wrangler dev server
npm test                  # vitest with isolated D1 per test
```
