# Static Encrypted CMS

Git is the database. JSON lives in the repo as **encrypted** files; the live site is **100% static** JSON on a CDN. Plaintext never lands in git.

This project is the focused successor to [`my-json-database`](../my-json-database) (legacy demo — leave that repo unchanged).

## Philosophy

- **Committed:** `data/encrypted/*.json.enc` only (AES-256-GCM).
- **Gitignored:** `data/source/` (CMS plaintext), `public/data/` (public build slice), `.env`.
- **Key:** `CONTENT_DECRYPT_KEY` in `.env` locally and in CI/host env — never in the client bundle.

## Quick start

```bash
npm install

# One-time: copy seed from my-json-database
npm run data:migrate-from-seed

# Create .env (min 16 chars)
echo "CONTENT_DECRYPT_KEY=$(openssl rand -base64 32)" > .env

# Encrypt → export public slice → dev
npm run data:encrypt
npm run dev
```

Open `http://localhost:5173` for the vault demo UI. CMS: `npm run cms` then `http://localhost:5173/admin/`.

## Commands

| Script | Description |
|--------|-------------|
| `data:migrate-from-seed` | Copy `my-json-database/public/data` → `data/source/` |
| `data:encrypt` | `data/source/` → `data/encrypted/*.json.enc` |
| `data:decrypt` | `data/encrypted/` → `data/source/` |
| `data:export` | Decrypt, filter public slice → `public/data/` |
| `cms` | Decrypt + Decap local backend proxy |
| `dev` / `build` | Runs `data:export` first (`predev` / `prebuild`) |

## Edit workflow

1. `npm run cms` (or `data:decrypt` first)
2. Edit in Decap at `/admin/` — files under `data/source/`
3. `npm run data:encrypt`
4. Commit **only** `data/encrypted/` changes (not `data/source/`)

Production `/admin` with git-gateway does **not** work with encrypted git yet. Use local CMS only.

## Deploy (Netlify)

Set `CONTENT_DECRYPT_KEY` in site environment variables. Build runs `npm run build` (`prebuild` exports public JSON into `dist/data/`).

## Docs

- [DATA-ENCRYPTION.md](docs/DATA-ENCRYPTION.md) — format, lost-key warning, CI
- [ECOSYSTEM.md](docs/ECOSYSTEM.md) — how other sites consume this vault
- [NEW-PROJECT-static-encrypted-cms-PROMPT.md](docs/NEW-PROJECT-static-encrypted-cms-PROMPT.md) — full project spec for agents

## Public JSON endpoints

After build, static files are served at:

- `/data/projects.json`
- `/data/personal-projects.json`
- `/data/highlights.json`
- `/data/profile.json`
- `/data/resume.json`
- `/data/blogs/index.json`
- `/data/blogs/{slug}.json`

Export excludes `status: draft`, `private: true`, and blog frontmatter `draft: true`.
