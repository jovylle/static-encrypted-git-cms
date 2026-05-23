# Content schemas

JSON Schema (draft 2020-12) for the file database (`data/source/`). Registry: [`manifest.collections.json`](./manifest.collections.json).

See [DATABASE.md](../docs/DATABASE.md).

| File | Schema |
|------|--------|
| `personal-projects.json` | [`personal-projects.schema.json`](./personal-projects.schema.json) |
| `projects.json` | [`projects.schema.json`](./projects.schema.json) |
| `highlights.json` | [`highlights.schema.json`](./highlights.schema.json) |
| `resume.json` | [`resume.schema.json`](./resume.schema.json) |

```bash
npm run data:validate
```

## Personal project shape

Source of truth: `data/source/personal-projects.json`. Supabase CSV columns (`priority_score`, `tech`, `links`, `is_published`) match this shape for one-time import only.

**Required per project:** `title`, `description`, `repo`, `updated_at`, `slug`, `status`, `private`, `fav`, `priority_score`, `tech`, `links`, `thumbnail`

**Optional:** `language` (display line, often `tech.join(', ')`)

**Removed (legacy Decap / GitHub sync):** `stars`, `showcase`, `netlify_live`, `netlify_status` — use `links` with label `Live` instead of host-only Netlify fields.

**`priority_score`:** integer 0–1000 from Supabase; higher sorts first (default `100` when unset).

Normalize existing JSON:

```bash
npm run data:import-personal-projects-from-supabase -- path/to/portfolio_projects_rows.csv
npm run data:normalize-personal-projects
npm run data:validate
```
