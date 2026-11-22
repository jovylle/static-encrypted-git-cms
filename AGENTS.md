# AGENTS.md

Read this before changing anything. Comments at the top of key source files carry the details; read them before editing.

## What this is

Encrypted, file-based content vault for jovylle.com. Git commits AES-256-GCM ciphertext (`data/encrypted/*.json.enc`). Plaintext exists only in `data/source/` (gitignored). `content.jovylle.com` serves public JSON in two ways: a Cloudflare Worker that decrypts live from GitHub, and a static export produced at build time.

## Layout

- `data/source/` plaintext, gitignored. Edit here.
- `data/encrypted/` committed ciphertext. Never edit by hand.
- `schemas/` JSON Schemas and `manifest.collections.json` (the collection registry).
- `scripts/` Node ESM CLIs (`data-*.mjs`, run through `npm run data:*`). `scripts/lib/` holds shared helpers (`export-public.mjs` is the export core).
- `packages/api/` Cloudflare Worker: public data routes and admin API (`src/routes`, `src/middleware`, `src/lib`), tests in `test/`, D1 migrations.
- `packages/sdk/` `@static-encrypted-cms/sdk`, the typed client.
- `src/` minimal Vue preview UI (dev only). `public/` static assets. `public/data/` is generated.
- `tests/` Node tests for `scripts/lib` and admin helpers (`npm run test:admin`). `tests/fixtures/` holds shared cases.

## Commands (verified)

- `npm ci`: install from the lockfile.
- `npm run build`: runs `data:export` (prebuild), then generates indices, then `vite build`.
- `npm --workspace @static-encrypted-cms/api run test`: Vitest, 119 tests. A first run once hit a transient `ECONNRESET`; a rerun passed.
- `cd packages/api && npx tsc --noEmit`: passes.
- `npm run test:admin`: all `tests/*.test.mjs` pass (96 tests). Not wired into CI yet (pending decision).
- `npm run data:decrypt`: writes `data/source/` from ciphertext. Needs a `CONTENT_DECRYPT_KEY` in `.env` that matches the committed ciphertext. Exits 1 if any file fails. `ALLOW_PARTIAL_EXPORT=1` allows a partial result (also applies to `data:export`).
- `npm run data:save`: validate, then encrypt. Run before every commit.
- `npm run dev`: runs `data:export`, then starts Vite.

## Hard rules

- Never commit `.env`, `data/source/`, or any plaintext. Never print the key.
- Never overwrite an existing `.env` key. A new random key makes every committed ciphertext undecryptable.
- Never hand-edit `data/encrypted/*.json.enc`. Change `data/source/`, then run `data:save`.
- Admin HTML exists in two copies: `public/admin/index.html` (tracked) and `packages/api/src/routes/admin/admin-html.ts` (the copy the Worker serves). They have diverged. Check the README before touching either.

## Known hazards (documented; most are not fixed)

- Silent re-key (fixed): every ciphertext writer (`data:encrypt`, `data:save`, personal-projects sync and backfill) runs the same guard (`encrypt-sync.mjs`). It refuses to replace an existing `.enc` that fails to decrypt, and writes nothing. `--force` is the only override.
- Fail closed (fixed): `data:export` and `data:decrypt` exit 1 after listing every decrypt failure. `ALLOW_PARTIAL_EXPORT=1` opts into exit 0. A missing or empty `.enc` is only a warning. A missing or unusable `CONTENT_DECRYPT_KEY` fails fast with one message, even with partial mode. `data:validate` fails when zero collections are found, or when an encrypted collection has no plaintext. Still true: `public/data/` is wiped before export, so a skipped file is missing, not empty.
- Publish controls (fixed): a missing, empty, undecryptable, or schema-invalid `publish-controls.json.enc` fails the export. Nothing gated is exported, even with `ALLOW_PARTIAL_EXPORT=1`. Legacy `personal_projects_public: false` beats `collections` (most restrictive wins).
- Intentionally public: `fast-scores.json` (no controls entry, so it cannot be gated).
- Open limitation (not implemented): the gate protects the static build only. The live Worker `/data/*` routes ignore publish controls and serve a `private` or `draft` collection.
- Worker parity (fixed): the live routes hide draft, private, expired, and blog-frontmatter `draft: true` items, like the export. Rules: `packages/api/src/lib/public-visibility.ts`. Shared cases: `tests/fixtures/visibility-cases.json`. Still open: the live routes do not apply publish controls, and each cache miss calls GitHub.
- `packages/api/src/middleware/auth.ts`: the session key falls back to `ADMIN_PASSWORD`. Set `ADMIN_SESSION_SECRET` to avoid it; removing the fallback needs a deployment change. Still open: Basic auth truncates passwords that contain `:`. Fixed: a malformed Basic header is 401, and `ADMIN_SESSION_TTL_SECONDS` is capped at 30 days with a warning on invalid values.
- `MANAGED_COLLECTION_IDS` (`visibility-mutators.ts`) excludes homepage, social, and uses. Left as is. The Worker's collection list is tested against the export's `COLLECTION_IDS`.

## Pointers

- `README.md`: operator guide, commands, deploy.
- `docs/CODEBASE-LEARNINGS.md`: architecture and data model.
- `docs/DATA-ENCRYPTION.md`: ciphertext format and key handling.
