# Static Encrypted CMS

Git is the database. JSON lives in the repo as **encrypted** files; the live site is **100% static** JSON on a CDN. Plaintext never lands in git.

This project is the focused successor to [`my-json-database`](../my-json-database) (legacy — **not** a supported runtime data host; see below).

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
| `data:sync-images-from-seed` | Copy `my-json-database/public/images/` → `public/images/` |
| `data:fix-image-urls` | Rewrite `/images/...` and pocket URLs in `data/source/` |
| `cms` | Decrypt + Decap local backend proxy |
| `dev` / `build` | Runs `data:export` first (`predev` / `prebuild`) |

## Edit workflow

1. Get plaintext: `npm run data:decrypt` (or `npm run cms` if you still use Decap locally)
2. Edit JSON under `data/source/` (IDE, scripts, or future [content-admin](./docs/FUTURE-ADMIN.md))
3. `npm run data:encrypt`
4. `git add .` → `git commit` → `git push`

`.gitignore` keeps `data/source/`, `public/data/`, and `.env` out of git — so `git add .` only stages safe files (mostly `data/encrypted/*.json.enc` plus code). **Always run `data:encrypt` before commit** so ciphertext matches your edits.

### Portfolio rebuild (after push to `master`)

When `data/encrypted/**` changes on `master`, GitHub Actions runs [`.github/workflows/trigger-portfolio-rebuild.yml`](.github/workflows/trigger-portfolio-rebuild.yml) and POSTs to your portfolio Netlify build hook so the site rebuilds against `https://content.jovylle.com`.

**One-time setup (do not commit the hook URL):**

1. Netlify → **portfolio** site → **Site configuration** → **Build & deploy** → **Build hooks** → create hook → copy URL.
2. GitHub → **this repo** → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**
3. Name: `PORTFOLIO_NETLIFY_BUILD_HOOK` — value: the full hook URL.

If the hook URL was ever pasted in chat, logs, or git, **rotate it** in Netlify and update the GitHub secret.

**Timing:** The portfolio build may start before `content.jovylle.com` finishes deploying this vault. If you see stale data, add a Netlify **deploy notification** on the vault site (deploy succeeded → portfolio build hook) or increase portfolio build delay. The Action only fires the hook; it does not wait for the vault CDN deploy.

Private and draft fields live inside the encrypted blobs in git; `data:export` strips them from the public CDN only.

Decap (`/admin/`) is optional legacy. Production git-gateway CMS does **not** work with encrypted git in v1.

## Deploy (Netlify)

Set `CONTENT_DECRYPT_KEY` in site environment variables. Build runs `npm run build` (`prebuild` exports public JSON into `dist/data/`).

Custom domain: **https://content.jovylle.com**

## Consuming content (portfolio & other apps)

**Supported public base URL (only):**

```text
https://content.jovylle.com
```

```js
const BASE = import.meta.env.VITE_CONTENT_BASE; // https://content.jovylle.com

const { projects } = await fetch(`${BASE}/data/personal-projects.json`).then((r) => r.json());
```

**Not supported for production consumers** (migration only):

- `https://pocket.uft1.com` — legacy deploy of `my-json-database`
- `https://github.com/jovylle/my-json-database` / local seed copy

Use `data:migrate-from-seed` or `data:import-personal-projects-from-seed` once to copy files into this vault, then edit and deploy here. Do not point new frontends at pocket.

## Docs

- [DATA-ENCRYPTION.md](docs/DATA-ENCRYPTION.md) — format, lost-key warning, CI
- [ECOSYSTEM.md](docs/ECOSYSTEM.md) — how other sites consume this vault
- [FUTURE-ADMIN.md](docs/FUTURE-ADMIN.md) — planned separate batch admin repo
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
