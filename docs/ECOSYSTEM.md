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

## Tier 3: Small content API (future)

For runtime private/draft access:

- Netlify Function (or similar) on the vault
- Holds `CONTENT_DECRYPT_KEY` server-side only
- Consumers send `Authorization: Bearer <SITE_API_TOKEN>` (per-site token, not the master key)
- Handler decrypts → applies allowlist → returns JSON
- CORS allowlist + rate limits

**Never** ship `CONTENT_DECRYPT_KEY` to Vue/React or decrypt `.enc` in the browser.

## What does not belong here

- API keys, passwords, PII — use env / secrets manager, not JSON in git
- Full portfolio UI — lives in consumer apps; this repo is vault + minimal proof UI

## Future admin (separate repo)

Planned replacement for Decap: a technical, batch-friendly panel in its **own** git repo. It edits the same `data/source/` shapes, then relies on this vault for encrypt → git → CDN.

See [FUTURE-ADMIN.md](./FUTURE-ADMIN.md).

## Legacy

[`my-json-database`](../my-json-database) and **pocket.uft1.com** are retired as content APIs. This vault (`content.jovylle.com`) is the only supported CDN for consumer apps.
