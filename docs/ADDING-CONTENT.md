# Adding blogs and notifications

How to add or edit **blog posts** and **site notifications** in this vault.

## Quick links

| What | Template | Admin |
|------|----------|-------|
| Blog post | [`data/templates/blog-post.json`](../data/templates/blog-post.json) | [/admin/blogs/](/admin/blogs/) |
| Notification | [`data/templates/notification.json`](../data/templates/notification.json) | [/admin/notifications/](/admin/notifications/) |

Public API after export:

- Blog index: `/data/blogs/index.json`
- Single post: `/data/blogs/{slug}.json`
- Notifications: `/data/notifications.json`

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

### Notification fields

Copy from [`data/templates/notification.json`](../data/templates/notification.json):

- **id** — unique stable id (`launch-2026`)
- **title**, **message**, **date**
- **type** — `info` | `success` | `warning` | `announcement`
- **status** — `published` | `draft` | `private`
- **link** — optional `{ label, url }`
- **expiresAt** — optional ISO date; omit or `null` if always on

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

**New notification**

1. Edit `data/source/notifications.json` — add an object to the `notifications` array (use the template).
2. Run `npm run data:save` and commit `data/encrypted/notifications.json.enc`.

**Publish to CDN**

Collection must be `public` in publish controls (`/admin/publish/` or `data/source/publish-controls.json`):

- `blogs`
- `notifications`

Then export runs on build:

```bash
npm run data:export
```

---

## Validation

Schemas live in `schemas/`:

- `blog-post.schema.json`
- `notifications.schema.json`

```bash
npm run data:validate
```

---

## See also

- [DATABASE.md](./DATABASE.md) — file database model
- [DATA-ENCRYPTION.md](./DATA-ENCRYPTION.md) — `.enc` format and export rules
