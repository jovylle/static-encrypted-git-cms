#!/usr/bin/env python3
"""
Import portfolio_projects_rows.csv into data/source/personal-projects.json.

- Uses CSV rows with is_published=true (deduped by repo)
- Merges netlify/fav/showcase/thumbnail/stars from existing JSON by repo
- Appends supplemental public repos not yet in the CSV export
"""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CSV_DEFAULT = Path(r"d:/TempHome/Downloadss/portfolio_projects_rows.csv")
OUT = ROOT / "data" / "source" / "personal-projects.json"

SUPPLEMENTAL = [
    {
        "slug": "static-encrypted-git-cms",
        "title": "static-encrypted-git-cms",
        "description": "Encrypted JSON content vault - git holds ciphertext; CDN serves public /data slice.",
        "repo": "https://github.com/jovylle/static-encrypted-git-cms",
        "language": "JavaScript",
        "status": "published",
        "private": False,
        "updated_at": "2026-05-21T12:00:00Z",
    },
]


def norm_repo(url: str | None) -> str | None:
    if not url:
        return None
    u = url.strip()
    if "github.com" not in u:
        return None
    if not u.startswith("http"):
        u = "https://" + u.lstrip("/")
    return u.rstrip("/").lower()


def repo_from_row(row: dict) -> str | None:
    raw = row.get("github_raw") or "{}"
    try:
        g = json.loads(raw)
    except json.JSONDecodeError:
        g = {}
    url = norm_repo(row.get("repo_url")) or norm_repo(g.get("html_url"))
    if not url:
        return None
    # canonical form
    parts = url.split("/")
    if len(parts) >= 5:
        return f"https://github.com/{parts[3]}/{parts[4]}"
    return url


def parse_tech(tech_str: str | None) -> list:
    if not tech_str:
        return []
    try:
        t = json.loads(tech_str)
        return t if isinstance(t, list) else []
    except json.JSONDecodeError:
        return []


def row_to_project(row: dict, existing: dict | None) -> dict | None:
    repo = repo_from_row(row)
    if not repo:
        return None

    try:
        g = json.loads(row.get("github_raw") or "{}")
    except json.JSONDecodeError:
        g = {}

    tech = parse_tech(row.get("tech"))
    language = (tech[0] if tech else None) or g.get("language") or (existing or {}).get("language") or ""

    updated_at = g.get("pushed_at") or row.get("updated_at") or (existing or {}).get("updated_at") or ""
    if updated_at and "T" not in updated_at and "+" in updated_at:
        updated_at = updated_at.replace(" ", "T").split("+")[0] + "Z"

    slug = (row.get("slug") or "").strip() or repo.rsplit("/", 1)[-1]
    title = (row.get("title") or "").strip() or slug

    project = {
        "title": title,
        "description": (row.get("description") or "").strip() or (existing or {}).get("description") or "",
        "repo": repo,
        "stars": g.get("stargazers_count")
        if g.get("stargazers_count") is not None
        else (existing or {}).get("stars", 0),
        "updated_at": updated_at,
        "language": language,
        "private": bool(g.get("private")) if "private" in g else (existing or {}).get("private", False),
        "status": "published" if str(row.get("is_published", "")).lower() == "true" else "draft",
        "fav": (existing or {}).get("fav", False),
        "showcase": (existing or {}).get("showcase", False),
        "netlify_live": (existing or {}).get("netlify_live"),
        "netlify_status": (existing or {}).get("netlify_status"),
        "thumbnail": (row.get("thumbnail") or "").strip() or (existing or {}).get("thumbnail") or "",
        "slug": slug,
    }
    for key in ("category", "name", "live"):
        if existing and existing.get(key) is not None:
            project[key] = existing[key]
    return project


def merge_project(base: dict, existing: dict | None) -> dict:
    if not existing:
        return base
    out = {**base}
    for key in (
        "description",
        "stars",
        "updated_at",
        "language",
        "fav",
        "showcase",
        "netlify_live",
        "netlify_status",
        "thumbnail",
        "category",
        "name",
        "live",
    ):
        ev = existing.get(key)
        if ev is None or ev == "":
            continue
        if key == "updated_at" and out.get("updated_at") and ev > out.get("updated_at", ""):
            out[key] = ev
        elif key == "description" and len(str(ev)) > len(str(out.get("description") or "")):
            out[key] = ev
        elif key in ("fav", "showcase", "netlify_live", "netlify_status", "thumbnail", "stars"):
            if ev:
                out[key] = ev
        elif key not in out or not out.get(key):
            out[key] = ev
    return out


def supplemental_to_project(item: dict, existing: dict | None) -> dict:
    repo = norm_repo(item["repo"])
    canonical = repo_from_row({"repo_url": item["repo"], "github_raw": "{}"}) or item["repo"]
    base = {
        "title": item.get("title") or item["slug"],
        "description": item.get("description", ""),
        "repo": canonical,
        "stars": (existing or {}).get("stars", 0),
        "updated_at": item.get("updated_at") or (existing or {}).get("updated_at") or "",
        "language": item.get("language", ""),
        "private": item.get("private", False),
        "status": item.get("status", "published"),
        "fav": item.get("fav", False),
        "showcase": item.get("showcase", False),
        "netlify_live": item.get("netlify_live"),
        "netlify_status": item.get("netlify_status"),
        "thumbnail": item.get("thumbnail", ""),
        "slug": item["slug"],
    }
    return merge_project(base, existing)


def main() -> int:
    csv_path = Path(sys.argv[1]) if len(sys.argv) > 1 else CSV_DEFAULT
    if not csv_path.is_file():
        print(f"CSV not found: {csv_path}", file=sys.stderr)
        return 1

    existing_by_repo: dict[str, dict] = {}
    if OUT.is_file():
        data = json.loads(OUT.read_text(encoding="utf-8"))
        for p in data.get("projects", []):
            r = norm_repo(p.get("repo"))
            if r:
                existing_by_repo[r] = p

    with csv_path.open(newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    projects_by_repo: dict[str, dict] = {}
    for row in rows:
        if str(row.get("is_published", "")).lower() != "true":
            continue
        repo_key = norm_repo(repo_from_row(row))
        if not repo_key:
            continue
        ex = existing_by_repo.get(repo_key)
        proj = row_to_project(row, ex)
        if not proj:
            continue
        proj = merge_project(proj, ex)
        projects_by_repo[repo_key] = proj

    for item in SUPPLEMENTAL:
        repo_key = norm_repo(item["repo"])
        if not repo_key:
            continue
        ex = existing_by_repo.get(repo_key)
        proj = supplemental_to_project(item, ex)
        projects_by_repo[repo_key] = proj

    projects = sorted(
        projects_by_repo.values(),
        key=lambda p: p.get("updated_at") or "",
        reverse=True,
    )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps({"projects": projects}, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    print(f"Wrote {len(projects)} projects to {OUT}")
    print(f"  from CSV published: {csv_path.name}")
    print(f"  supplemental: {[s['slug'] for s in SUPPLEMENTAL]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
