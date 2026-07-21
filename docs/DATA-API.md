# Data API (Cloudflare D1) — Consumer Guide

The dynamic, high-write side of this project's data lives in a Cloudflare D1 database
(`cms-db`, bound as `env.DB` in `packages/api/`) — separate from the encrypted git-backed
JSON collections (projects, blogs, notifications) documented in the main
[README's "Consuming content" section](../README.md#consuming-content-portfolio--other-apps).
This doc covers the 9 D1 tables and their HTTP endpoints, for apps like `playbase` or
`fast.jovylle.com` that want to read or write this data.

**Base URL:** `https://content.jovylle.com`

CORS is wide open (`Access-Control-Allow-Origin: *`), so you can `fetch()` straight from a
browser app — no proxy needed.

## Auth

Some endpoints are public (safe for a visitor-facing site to call directly); others require
the admin credential and are meant for **your own backend/admin tooling only** — never ship
the admin password into client-side JS.

```js
const auth = 'Basic ' + btoa(`admin:${ADMIN_PASSWORD}`);
fetch('https://content.jovylle.com/api/contacts', { headers: { Authorization: auth } });
```

## Rate limits

| Category | Limit |
|---|---|
| `read` (GET) | 60 requests/min per IP |
| `write` (POST/PUT/DELETE) | 30 requests/min per IP |

Responses include `x-ratelimit-limit` / `x-ratelimit-remaining` headers; a 429 includes
`retryAfter` seconds.

## Endpoints

| Resource | Method & path | Auth | Notes |
|---|---|---|---|
| **Feature flags** | `GET /api/feature-flags` | public | list all |
| | `GET /api/feature-flags/{key}` | public | single flag |
| | `POST /api/feature-flags` `{key, enabled?, description?}` | admin | create |
| | `PUT /api/feature-flags/{key}` `{enabled?, description?}` | admin | update |
| | `DELETE /api/feature-flags/{key}` | admin | delete |
| **Contact submissions** | `POST /api/contacts` `{name, email, subject?, message}` | public | your contact form posts here |
| | `GET /api/contacts` / `GET /api/contacts/{id}` | admin | read |
| | `PUT /api/contacts/{id}` `{status}` | admin | status ∈ `unread\|read\|replied\|spam` |
| | `DELETE /api/contacts/{id}` | admin | |
| **Conversations** (chat threads) | `POST /api/conversations` `{title?, message}` | public | creates thread + first message |
| | `GET /api/conversations` | public | flat list (no messages) |
| | `GET /api/conversations/{id}` | public | single thread **with** its `messages[]` |
| | `POST /api/conversations/{id}/messages` `{role?, content}` | public | append a message |
| | `PUT /api/conversations/{id}` `{title}` | admin | rename |
| | `DELETE /api/conversations/{id}` | admin | |
| **Comments** | `GET /api/comments?target_type=&target_id=` | public | only `status: approved` |
| | `POST /api/comments` `{target_type, target_id, author_name, author_email?, content}` | public | starts as `pending`, needs moderation |
| | `GET /api/comments/all` | admin | all statuses |
| | `PUT /api/comments/{id}` `{status}` | admin | status ∈ `approved\|rejected\|spam` |
| | `DELETE /api/comments/{id}` | admin | |
| **Likes** | `POST /api/likes/toggle` `{target_type, target_id, visitor_id}` | public | toggles like on/off, returns `{liked, count}` |
| | `GET /api/likes/count?target_type=&target_id=` | public | count for one target |
| | `GET /api/likes` | admin | full raw list of all like rows |
| **Todos** | `GET /api/todos` / `GET /api/todos/{id}` | admin | |
| | `POST /api/todos` `{title, content?, status?, priority?}` | admin | status ∈ `open\|in_progress\|done` |
| | `PUT /api/todos/{id}` (any subset of same fields) | admin | |
| | `DELETE /api/todos/{id}` | admin | |
| **Scores** (game leaderboards) | `GET /api/scores?game=&sort=top\|recent&limit=` | public | returns `{scores: [...]}`; `sort=top` = fastest `ms` first, `sort=recent` (default) = newest first; `limit` default 10, max 200; filter by `game` |
| | `POST /api/scores` `{game, ms, playerName, playerId}` | admin | `ms` = positive integer (lower is better); returns the created row |
| | `DELETE /api/scores/{id}` | admin | |
| **Audit log** | `GET /api/audit-logs` | admin | read-only, capped at latest 100 rows |

## `target_type` / `target_id` convention

Comments and likes are generic — `target_type` is whatever your app calls the thing being
commented/liked (e.g. `"blog-post"`, `"project"`), `target_id` is that item's slug/id. Use
the same pair consistently across comments and likes for a given entity if you want them to
line up.

## Browsing without code

Everything above (except `contacts`/`comments`/`todos` which need admin), plus the admin-only
ones, can be **eyeballed** at `https://content.jovylle.com/admin/` → "Data (D1)" section —
read-only tables, no write UI yet. Handy for debugging without writing a script, but it
requires the admin password just like the endpoints above. (`scores` isn't wired into this
viewer yet — its `GET` returns a `{scores: [...]}` envelope instead of a bare array, which
the viewer doesn't unwrap; query `/api/scores` directly to inspect it for now.)

This same content is also served at `https://content.jovylle.com/docs/data-api` for quick
reference without opening the repo.
