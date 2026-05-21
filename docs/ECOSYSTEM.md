# Ecosystem — vault as content center

`static-encrypted-cms` is the **encrypted source of truth**. Other apps consume content in one of three tiers.

## Tier 1: Public static JSON (default)

Deploy the vault (or any mirror) and fetch public endpoints:

```js
const projects = await fetch('https://your-vault.netlify.app/data/projects.json').then((r) => r.json());
```

No API key. Only data that passed `data:export` (no drafts, no `private: true`).

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

[`my-json-database`](../my-json-database) remains a demo; new work happens here.
