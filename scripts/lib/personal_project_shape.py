"""Canonical personal-project dict (schemas/personal-projects.schema.json)."""

from __future__ import annotations

import json
import re
from typing import Any
from urllib.parse import urlparse

DEPRECATED_KEYS = frozenset(
    {
        "stars",
        "showcase",
        "netlify_live",
        "netlify_status",
        "category",
        "name",
        "live",
        "draft_or_published",
        "priority_level",
        "github",
    }
)


def norm_repo(url: str | None) -> str | None:
    if not url:
        return None
    u = url.strip()
    if "github.com" not in u:
        return None
    if not u.startswith("http"):
        u = "https://" + u.lstrip("/")
    parts = u.rstrip("/").lower().split("/")
    if len(parts) >= 5:
        return f"https://github.com/{parts[3]}/{parts[4]}"
    return u.rstrip("/").lower()


def canonical_repo(url: str | None) -> str | None:
    n = norm_repo(url)
    if not n:
        return None
    parts = n.split("/")
    if len(parts) >= 5:
        return f"https://github.com/{parts[3]}/{parts[4]}"
    return n


def parse_tech(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(x).strip() for x in value if str(x).strip()]
    if not value:
        return []
    if isinstance(value, str):
        raw = value.strip()
        if raw.startswith("["):
            try:
                parsed = json.loads(raw)
                return parse_tech(parsed)
            except json.JSONDecodeError:
                pass
        return [p.strip() for p in re.split(r"[,;|]", raw) if p.strip()]
    return []


def parse_links(value: Any) -> list[dict[str, str]]:
    if not value:
        return []
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return []
    if not isinstance(value, list):
        return []
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for link in value:
        if not isinstance(link, dict):
            continue
        label = str(link.get("label") or "").strip()
        url = str(link.get("url") or "").strip()
        if not label or not url:
            continue
        key = f"{label.lower()}|{url}"
        if key in seen:
            continue
        seen.add(key)
        out.append({"label": label, "url": url})
    return out


def live_url_from_host(host: str | None) -> str | None:
    if not host:
        return None
    h = str(host).strip()
    if not h or h.lower() == "null":
        return None
    if h.startswith("http://") or h.startswith("https://"):
        return h.rstrip("/") + "/"
    return f"https://{h.rstrip('/')}/"


def build_links(raw: dict, repo: str) -> list[dict[str, str]]:
    parsed = parse_links(raw.get("links"))
    if parsed:
        return parsed

    links: list[dict[str, str]] = []
    if repo:
        links.append({"label": "Repo", "url": repo})

    live = raw.get("live") or raw.get("netlify_live")
    live_url = live_url_from_host(live)
    if live_url:
        links.append({"label": "Live", "url": live_url})

    return links if links else ([{"label": "Repo", "url": repo}] if repo else [])


def normalize_updated_at(value: str | None) -> str:
    if not value or not str(value).strip():
        return "1970-01-01T00:00:00Z"
    v = str(value).strip()
    if "T" not in v and ("+" in v or " " in v):
        v = v.replace(" ", "T").split("+")[0]
    if not v.endswith("Z") and not re.search(r"[+-]\d{2}:\d{2}$", v):
        v += "Z"
    return v


def normalize_created_at(value: str | None) -> str | None:
    if not value or not str(value).strip():
        return None
    return normalize_updated_at(value)


def read_created_at(raw: dict) -> str | None:
    github_raw = raw.get("github_raw")
    nested = github_raw.get("created_at") if isinstance(github_raw, dict) else None
    return normalize_created_at(raw.get("created_at") or nested)


def parse_priority_score(value: Any, fallback: int = 100) -> int:
    if value is None or value == "":
        return fallback
    try:
        n = int(float(value))
    except (TypeError, ValueError):
        return fallback
    return max(0, min(1000, n))


def normalize_project(raw: dict, overlay: dict | None = None) -> dict:
    repo = canonical_repo(raw.get("repo")) or str(raw.get("repo") or "").strip()
    slug = (str(raw.get("slug") or "").strip() or (repo.rsplit("/", 1)[-1] if repo else "project"))

    tech = parse_tech((overlay or {}).get("tech") or raw.get("tech"))
    if not tech and raw.get("language"):
        tech = parse_tech(raw.get("language"))

    links = parse_links((overlay or {}).get("links")) or build_links(raw, repo)

    status_raw = raw.get("status") or raw.get("draft_or_published")
    if status_raw in ("draft", "published"):
        status = status_raw
    elif str(raw.get("is_published", "")).lower() == "true":
        status = "published"
    else:
        status = "published" if status_raw == "published" else "draft"

    out: dict[str, Any] = {
        "title": (str(raw.get("title") or slug).strip() or slug),
        "description": (str(raw.get("description") or "").strip()),
        "repo": repo,
        "updated_at": normalize_updated_at(raw.get("updated_at")),
        "slug": slug,
        "status": status,
        "private": bool(raw.get("private")),
        "fav": bool(raw.get("fav")),
        "priority_score": parse_priority_score(
            (overlay or {}).get("priority_score", raw.get("priority_score", raw.get("priority_level"))),
            100,
        ),
        "tech": tech,
        "links": links,
        "thumbnail": (str(raw.get("thumbnail") or "").strip()),
    }

    created_at = read_created_at(raw)
    if created_at:
        out["created_at"] = created_at

    if tech:
        out["language"] = ", ".join(tech)
    elif raw.get("language"):
        out["language"] = str(raw.get("language")).strip()

    return out


def row_to_project(row: dict, fill: dict | None = None) -> dict | None:
    """Map Supabase portfolio_projects CSV row → vault project."""
    g = {}
    try:
        g = json.loads(row.get("github_raw") or "{}")
    except json.JSONDecodeError:
        pass

    repo = canonical_repo(row.get("repo_url")) or canonical_repo(g.get("html_url"))
    if not repo:
        return None

    overlay = {
        "priority_score": row.get("priority_score"),
        "tech": parse_tech(row.get("tech")),
        "links": parse_links(row.get("links")),
    }

    raw = {
        "title": (row.get("title") or "").strip() or repo.rsplit("/", 1)[-1],
        "description": (row.get("description") or "").strip() or (fill or {}).get("description") or "",
        "repo": repo,
        "updated_at": g.get("pushed_at") or row.get("updated_at") or (fill or {}).get("updated_at"),
        "created_at": g.get("created_at") or (fill or {}).get("created_at"),
        "slug": (row.get("slug") or "").strip() or repo.rsplit("/", 1)[-1],
        "private": bool(g.get("private")) if "private" in g else bool((fill or {}).get("private")),
        "is_published": row.get("is_published"),
        "status": "published" if str(row.get("is_published", "")).lower() == "true" else "draft",
        "fav": bool((fill or {}).get("fav")),
        "thumbnail": (row.get("thumbnail") or "").strip() or (fill or {}).get("thumbnail") or "",
        **{k: (fill or {}).get(k) for k in ("live", "links") if (fill or {}).get(k)},
    }

    proj = normalize_project(raw, overlay)
    if overlay["tech"]:
        proj["tech"] = overlay["tech"]
        proj["language"] = ", ".join(overlay["tech"])
    if overlay["links"]:
        proj["links"] = overlay["links"]
    return proj
