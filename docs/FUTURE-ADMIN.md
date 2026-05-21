# Future content admin (separate repo)

Decap CMS in this vault is **optional legacy** from [`my-json-database`](../my-json-database). It is not the long-term editing model.

The planned replacement is a **separate git repo**: a technical, fast admin web panel (batch edit, schema validation, diffs) that still writes the same plaintext files this vault encrypts.

## Split of responsibilities

| Repo | Role |
|------|------|
| **static-encrypted-cms** (this repo) | Encrypt/decrypt scripts, `data/encrypted/` in git, Netlify build → `content.jovylle.com/data/*` |
| **content-admin** (future, separate) | UI/CLI for editing JSON, bulk ops, schemas, preview; never ships `CONTENT_DECRYPT_KEY` to browsers |

```text
content-admin (future)          static-encrypted-cms (vault)
        │                                │
        │  edit plaintext                │  encrypt + git + CDN
        ▼                                ▼
   data/source/*.json  ──encrypt──►  data/encrypted/*.json.enc
                                              │
                                              ▼ export (build)
                                    content.jovylle.com/data/*.json
```

## Design goals for the future panel

- **Batch-first** — multi-select, bulk status/private/tags, slug renames
- **Schema-aware** — JSON Schema / Zod per file type; fail before encrypt
- **Diff preview** — see what changed before commit/PR
- **Export dry-run** — preview what `data:export` would publish vs keep private
- **Keyboard / power-user** — tables, CLI hooks, optional AI assist on structured JSON
- **No Decap widget lock-in** — arbitrary JSON shapes; panel follows schemas you own

## How it plugs into the vault (options)

Pick one when building; all keep the master key out of public frontends.

1. **Local clone (simplest v0)** — Admin repo clones or submodules this vault, runs `data:decrypt`, edits `data/source/`, runs `data:encrypt`, then `git push` on the **vault** repo (or opens a PR).
2. **PR automation** — Panel uses GitHub API: branch → edit JSON in vault → PR → CI runs `data:encrypt` with `CONTENT_DECRYPT_KEY` in Actions secrets.
3. **Runtime API (Tier 3)** — See [ECOSYSTEM.md](./ECOSYSTEM.md): small API on the vault with per-site `SITE_API_TOKEN` for draft/private at runtime (not for replacing git as source of truth).

## Contract the admin must respect

- **Plaintext path:** `data/source/` (gitignored here; never commit)
- **Ciphertext path:** `data/encrypted/` (commit only after `npm run data:encrypt`)
- **Scripts:** `data:decrypt`, `data:encrypt`, `data:export` in this repo’s `package.json`
- **Public URL:** `https://content.jovylle.com/data/` (Tier 1 consumers)
- **Export rules:** [DATA-ENCRYPTION.md](./DATA-ENCRYPTION.md) — drafts/`private` stay in encrypted git but are stripped from `/data/*` on deploy

## Decap in this repo

- **Local only:** `npm run cms` → `/admin/` with `local_backend`
- **Production:** git-gateway + encrypted git is **not** supported in v1
- Safe to ignore or remove `public/admin/` once the new admin exists

## Suggested build order (future repo)

1. JSON Schema + `validate` script against `data/source/`
2. Bulk CLI (e.g. publish N posts, toggle `private`)
3. Minimal web UI on top of the same file writes
4. Optional GitHub PR flow + encrypt CI on the vault repo
