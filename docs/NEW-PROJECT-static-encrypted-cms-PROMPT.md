# New project: Static Encrypted Git CMS ("file vault")

**Agent prompt** — full product spec. Implementation lives in this repo.

## Mission

1. **Git is the database** — JSON (and media paths) in the repo. No Supabase, no hosted CMS DB.
2. **Sensitive data encrypted in git** — only `data/encrypted/*.json.enc` committed.
3. **Live site 100% static** — build decrypts → public slice → `public/data/` → CDN.
4. **Edit rarely** — local Decap CMS + encrypt workflow.

Leave **`my-json-database`** unchanged (legacy). Seed from `../my-json-database/public/data`.

## Paths

| Path | Git? | Purpose |
|------|------|---------|
| `data/encrypted/` | Yes | Ciphertext source of truth |
| `data/source/` | No | Plaintext for Decap |
| `public/data/` | No | Generated public JSON |
| `.env` | No | `CONTENT_DECRYPT_KEY` |

## Encryptor

- `aes-256-gcm`, `scryptSync(CONTENT_DECRYPT_KEY, 'static-encrypted-cms-content-v1', 32)`
- Wrapper: `{ v: 1, iv, tag, data }` base64
- Extension: `*.json.enc`

Scripts: `data:migrate-from-seed`, `data:encrypt`, `data:decrypt`, `data:export`, `cms`, `build`.

## Public export

- `projects`, `personal-projects`, `blogs`: exclude `draft` / `private`
- `highlights`, `profile`, `resume`: full file (v1)
- Omit `function-logs.json`

## Decap

- `public/admin/config.yml` → paths under `data/source/`
- `local_backend: true`; production git-gateway N/A until encrypt-on-commit

## Ecosystem (later)

See [ECOSYSTEM.md](./ECOSYSTEM.md) — public CDN fetch, per-site CI export profiles, optional content API with `SITE_API_TOKEN`.
