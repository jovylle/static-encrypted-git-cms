# Data encryption

## On-disk format

Each encrypted file is UTF-8 JSON:

```json
{
  "v": 1,
  "iv": "<base64>",
  "tag": "<base64>",
  "data": "<base64 ciphertext>"
}
```

- **Algorithm:** AES-256-GCM (Node `crypto` only)
- **Key derivation:** `scryptSync(CONTENT_DECRYPT_KEY, 'static-encrypted-cms-content-v1', 32)`
- **Filename:** `*.json.enc` (e.g. `projects.json.enc`, `blogs/my-post.json.enc`)

## Environment

Create `.env` from `.env.example`:

```bash
CONTENT_DECRYPT_KEY=$(openssl rand -base64 32)
```

Requirements:

- Minimum **16 characters**
- Never commit `.env`
- Never add to Vite `import.meta.env` or client code

Scripts load `.env` via `loadDotEnv()` in `scripts/lib/data-io.mjs` (Node does not auto-load `.env`).

## Workflows

### Initial setup

```bash
npm run data:migrate-from-seed
# set CONTENT_DECRYPT_KEY in .env
npm run data:encrypt
git add data/encrypted/   # only ciphertext
```

### Edit content

```bash
npm run data:save           # validate + encrypt
# edit via http://localhost:5173/admin/
npm run data:encrypt        # update .enc files
git add data/encrypted/
```

### Build / deploy

```bash
npm run data:export         # → public/data/ (gitignored)
npm run build               # → dist/ includes public/data/
```

Netlify (or any host) must set `CONTENT_DECRYPT_KEY` so `prebuild` can export.

## Public export rules

| File | Rule |
|------|------|
| `projects.json`, `personal-projects.json` | Drop items with `status === 'draft'` or `private === true` |
| `blogs/*.json` | Same + frontmatter `draft: true` in `body` |
| `highlights`, `profile`, `resume` | Full export (v1) |
| `function-logs.json` | Not exported |

## Lost key warning

If you lose `CONTENT_DECRYPT_KEY`, **encrypted files cannot be recovered**. There is no backdoor. Keep a copy in a password manager and in your host’s secret store.

## What must never be committed

- `data/source/` (plaintext)
- `public/data/*.json` (generated public slice)
- `.env`
