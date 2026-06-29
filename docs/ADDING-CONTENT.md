# Adding content to the vault

How to add or edit **blog posts**, **notifications**, and **personal projects** in this vault.

## Quick links

| What | Template | Admin |
|------|----------|-------|
| Blog post | [`data/templates/blog-post.json`](../data/templates/blog-post.json) | [/admin/blogs/](/admin/blogs/) |
| Notification | [`data/templates/notification.json`](../data/templates/notification.json) | [/admin/notifications/](/admin/notifications/) |
| Personal project | [`data/templates/personal-project.json`](../data/templates/personal-project.json) | [/admin/](/admin/) → **Personal projects** |

Public API after export:

- Blog index: `/data/blogs/index.json`
- Single post: `/data/blogs/{slug}.json`
- Notifications: `/data/notifications.json`
- Personal projects: `/data/personal-projects.json`

---

## Option A — Content admin (recommended)

1. Open [/admin/](/admin/) and sign in.
2. Choose **Blog posts** or **Notifications**.
3. For blogs: click a row to edit, or **New post** to create one (slug = URL segment, e.g. `my-update`).
4. For notifications: use the table editor or open a single row.
5. **Save** — changes are encrypted and committed to GitHub (or opened as a PR, depending on deploy config).
6. After deploy, the CDN rebuild exports public JSON to `content.jovylle.com`.

### Blog post fields

Copy from [`data/templates/blog-post.json`](../data/templates/blog-post.json):

- **slug** — lowercase, hyphens only (`my-new-post`)
- **title**, **excerpt**, **date**, **author**
- **status** — `published` | `draft` | `private`
- **content** — Markdown body (preferred)
- **body** — legacy frontmatter block (optional; keep `draft: false` when publishing)
- **tags**, **thumbnail**, **featured**

Draft posts stay out of the public export until `status` is `published` and `private` is false.

### Personal project fields

Copy from [`data/templates/personal-project.json`](../data/templates/personal-project.json). Add or edit a row in **`data/source/personal-projects.json`** (array under `projects`).

- **slug** — stable id, usually the GitHub repo name (`all-the-skills-python`)
- **title**, **description**, **repo**
- **updated_at** — ISO 8601; use the project’s real era when it is an older milestone
- **created_at** — ISO 8601; when the GitHub repo was created (project start year on the portfolio)
- **status** — `published` | `draft` | `private`
- **private** — `false` to include in public export
- **priority_score** — `0`–`1000`; lower = less prominent in the portfolio sort
- **tech** — string array (e.g. `Python`, `Django Girls`)
- **links** — at least one `{ label, url }`; use **Repo** and **Live** (GitHub Pages or deployed URL)
- **thumbnail**, **language** — optional display helpers

Example (college archive): slug `all-the-skills-python`, Live → `https://jovylle.github.io/all-the-skills-python/`.

Draft or private projects are omitted from `/data/personal-projects.json` on export.

### Notification fields

Copy from [`data/templates/notification.json`](../data/templates/notification.json). Add or edit a bundle under **`data/source/notifications/`** — one file per date (`2026-06-29.json`) or `pinned.json` for evergreen alerts.

Each file is `{ "notifications": [ /* items */ ] }`.

Per-item fields:

- **id** — unique stable id (`chatgpt-search-v2`)
- **title**, **message**
- **type** — `info` | `success` | `warning` | `announcement` (widget maps `announcement` → `success`)
- **tags** — e.g. `["all", "jovylle.com"]` (widget filters by `data-notification-tags`)
- **timestamp** — ISO 8601 for widget sort order
- **persistent** — `true` stays until dismissed; `false` auto-dismisses after 10s
- **status** — `published` | `draft` | `private`
- **date** — `YYYY-MM-DD` (CMS listing + bundle file name)
- **link** — optional `{ label, url }` (appended to message on widget export)
- **expiresAt** — optional ISO date; omit or `null` if always on

After export:

- Widget archive: `/notifications/index.json` + `/notifications/{date}.json`
- Flat CMS feed: `/data/notifications.json` (aggregated, deduped by id)

---

## Option B — Local files + CLI

```bash
npm run data:decrypt   # optional: refresh data/source from .enc
```

**New blog post**

1. Copy the template:
   ```bash
   cp data/templates/blog-post.json data/source/blogs/my-slug.json
   ```
2. Edit slug, title, content, status.
3. Save and encrypt:
   ```bash
   npm run data:save
   git add data/encrypted/blogs/my-slug.json.enc
   ```

**New notification bundle**

1. Copy the template item into a new file:
   ```bash
   cp data/templates/notification.json data/source/notifications/2026-06-29.json
   # Edit to wrap in { "notifications": [ ... ] }
   ```
2. Or edit an existing `data/source/notifications/YYYY-MM-DD.json`.
3. Run `npm run data:save` and commit `data/encrypted/notifications/*.json.enc`.

**New or updated personal project**

1. Open `data/source/personal-projects.json`.
2. Add a project object from [`data/templates/personal-project.json`](../data/templates/personal-project.json), or update an existing row by **slug**.
3. Run `npm run data:save` and commit `data/encrypted/personal-projects.json.enc`.

**Publish to CDN**

Collection must be `public` in publish controls (`/admin/publish/` or `data/source/publish-controls.json`):

- `blogs`
- `notifications`
- `personal-projects`

Then export runs on build:

```bash
npm run data:export
```

---

## Validation

Schemas live in `schemas/`:

- `blog-post.schema.json`
- `notifications.schema.json`
- `personal-projects.schema.json`

```bash
npm run data:validate
```

---

## See also

- [DATABASE.md](./DATABASE.md) — file database model
- [DATA-ENCRYPTION.md](./DATA-ENCRYPTION.md) — `.enc` format and export rules
