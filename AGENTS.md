# AGENTS.md

Read this before changing anything. Comments at the top of key source files carry the details; read them before editing.

## What this is

Encrypted, file-based content vault for jovylle.com. Git commits AES-256-GCM ciphertext (`data/encrypted/*.json.enc`). Plaintext exists only in `data/source/` (gitignored). `content.jovylle.com` serves public JSON in two ways: a Cloudflare Worker that decrypts live from GitHub, and a static export produced at build time.

## Layout

- `data/source/` plaintext, gitignored. Edit here.
- `data/encrypted/` committed ciphertext. Never edit by hand.
- `schemas/` JSON Schemas and `manifest.collections.json` (the collection registry).
- `scripts/` Node ESM CLIs (`data-*.mjs`, run through `npm run data:*`). `scripts/lib/` holds shared helpers.
- `packages/api/` Cloudflare Worker: public data routes and admin API (`src/routes`, `src/middleware`, `src/lib`), tests in `test/`, D1 migrations.
- `packages/sdk/` `@static-encrypted-cms/sdk`, the typed client.
- `src/` minimal Vue preview UI (dev only). `public/` static assets. `public/data/` is generated.
- `tests/` Node tests for `scripts/lib` and admin helpers (`npm run test:admin`).

## Commands (verified)

- `npm ci`: install from the lockfile.
- `npm run build`: runs `data:export` (prebuild), then generates indices, then `vite build`.
- `npm --workspace @static-encrypted-cms/api run test`: Vitest. Passes 70/70. A first run once hit a transient `ECONNRESET`; a rerun passed.
- `cd packages/api && npx tsc --noEmit`: passes.
- `npm run test:admin`: 19 pass, 2 known failures: "validateCollectionData accepts minimal valid publish-controls" and "collection controls normalization defaults to public".
- `npm run data:decrypt`: writes `data/source/` from ciphertext. Needs a `CONTENT_DECRYPT_KEY` in `.env` that matches the committed ciphertext.
- `npm run data:save`: validate, then encrypt. Run before every commit.
- `npm run dev`: runs `data:export`, then starts Vite.

## Hard rules

- Never commit `.env`, `data/source/`, or any plaintext. Never print the key.
- Never overwrite an existing `.env` key. A new random key makes every committed ciphertext undecryptable.
- Never hand-edit `data/encrypted/*.json.enc`. Change `data/source/`, then run `data:save`.
- Admin HTML exists in two copies: `public/admin/index.html` (tracked) and `packages/api/src/routes/admin/admin-html.ts` (the copy the Worker serves). They have diverged. Check the README before touching either.

## Known hazards (documented; most are not fixed)

- `scripts/lib/encrypt-sync.mjs`: a wrong key makes `data:encrypt` overwrite committed `.enc` files. It reports them as `created`.
- `scripts/data-export.mjs`: a decrypt failure skips the file and still exits 0. `public/data/` is wiped first, so the file is missing, not empty. Exception: `public/data/notifications.json` is written as an empty list when the notifications directory exists and every bundle fails to decrypt.
- Publish controls: the Worker's live `/data/*.json` path ignores them. If only `publish-controls.json.enc` fails to decrypt, every collection defaults to public.
- `packages/api/src/middleware/auth.ts`: the session key falls back to `ADMIN_PASSWORD`; the TTL is hard-coded to 8h (`ADMIN_SESSION_TTL_SECONDS` is never read); the signature is compared with `!==`; Basic auth truncates passwords containing `:`.
- `packages/api/src/routes/data-file.ts`: duplicates the export's filters and can disagree on blog drafts. Each cache miss calls GitHub.
- Blog drafts: a post with top-level `draft: true` is hidden on the Worker but PUBLISHED in the static export (`isPublicBlogPost` ignores it). Potential content leak.

## Pointers

- `README.md`: operator guide, commands, deploy.
- `docs/CODEBASE-LEARNINGS.md`: architecture and data model.
- `docs/DATA-ENCRYPTION.md`: ciphertext format and key handling.
