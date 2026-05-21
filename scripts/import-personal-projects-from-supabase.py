#!/usr/bin/env python3
"""
Build data/source/personal-projects.json from Supabase portfolio_projects (+ GitHub gap-fill).

Source of truth: Supabase table `portfolio_projects` (descriptions, links, tech, is_published).
Gap-fill: GitHub-synced repos from my-json-database not yet in Supabase (new projects).

Input: optional CSV export path (argv[1]). CSV is a convenience snapshot only — edit in
Supabase, re-export when syncing. Direct Supabase API sync can replace CSV later.

Then run:
  npm run data:fix-image-urls
  npm run data:encrypt
"""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
CSV_DEFAULT = Path(r"d:/TempHome/Downloadss/portfolio_projects_rows.csv")
SEED = ROOT.parent / "my-json-database" / "public" / "data" / "personal-projects.json"
OUT = ROOT / "data" / "source" / "personal-projects.json"

# Always ensure vault repo is present (may be missing from Supabase export).
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
        "netlify_live": "content.jovylle.com",
        "netlify_status": "current",
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


def canonical_repo(url: str | None) -> str | None:
    n = norm_repo(url)
    if not n:
        return None
    parts = n.split("/")
    if len(parts) >= 5:
        return f"https://github.com/{parts[3]}/{parts[4]}"
    return n


def parse_json_field(raw: str | None, default):
    if not raw:
        return default
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return default


def parse_tech(tech_str: str | None) -> list[str]:
    t = parse_json_field(tech_str, [])
    return [x for x in t if isinstance(x, str) and x] if isinstance(t, list) else []


def normalize_links(links_str: str | None) -> list[dict]:
    """Preserve Supabase links JSON for consumers (e.g. jovylle.com project cards)."""
    links = parse_json_field(links_str, [])
    if not isinstance(links, list):
        return []
    out: list[dict] = []
    for link in links:
        if not isinstance(link, dict):
            continue
        url = (link.get("url") or "").strip()
        if not url:
            continue
        label = (link.get("label") or "").strip() or "Link"
        out.append({"url": url, "label": label})
    return out


def live_from_links(links: list[dict]) -> tuple[str | None, str | None]:
    for link in links:
        label = str(link.get("label") or "").lower()
        url = (link.get("url") or "").strip()
        if label == "live" and url:
            host = urlparse(url).netloc or url.replace("https://", "").replace("http://", "").split("/")[0]
            return host or None, "current"
    return None, None


def resolve_input_path(path: Path) -> Path:
    """Supabase SQL dumps: use sibling CSV export when present."""
    if path.suffix.lower() == ".sql":
        csv_sibling = path.with_suffix(".csv")
        if csv_sibling.is_file():
            print(f"SQL path given; using CSV export: {csv_sibling}")
            return csv_sibling
    return path


def normalize_updated_at(value: str | None) -> str:
    if not value:
        return ""
    v = value.strip()
    if "T" not in v and ("+" in v or " " in v):
        v = v.replace(" ", "T").split("+")[0]
        if not v.endswith("Z"):
            v += "Z"
    return v


def repo_from_row(row: dict) -> str | None:
    g = parse_json_field(row.get("github_raw"), {})
    return canonical_repo(row.get("repo_url")) or canonical_repo(g.get("html_url"))


def row_to_project(row: dict, fill: dict | None = None) -> dict | None:
    """Map one Supabase portfolio_projects row → vault personal-project item."""
    repo = repo_from_row(row)
    if not repo:
        return None

    g = parse_json_field(row.get("github_raw"), {})
    tech = parse_tech(row.get("tech"))
    language = ", ".join(tech) if tech else (g.get("language") or (fill or {}).get("language") or "")

    updated_at = normalize_updated_at(g.get("pushed_at") or row.get("updated_at"))
    if not updated_at and fill:
        updated_at = fill.get("updated_at") or ""

    slug = (row.get("slug") or "").strip() or repo.rsplit("/", 1)[-1]
    title = (row.get("title") or "").strip() or slug

    links = normalize_links(row.get("links"))
    if not links and fill:
        links = normalize_links(json.dumps(fill.get("links"))) if fill.get("links") else []

    netlify_live, netlify_status = live_from_links(links)
    if not netlify_live and fill:
        netlify_live = fill.get("netlify_live")
        netlify_status = fill.get("netlify_status")

    published = str(row.get("is_published", "")).lower() == "true"

    project = {
        "title": title,
        "description": (row.get("description") or "").strip() or (fill or {}).get("description") or "",
        "repo": repo,
        "stars": g.get("stargazers_count") if g.get("stargazers_count") is not None else (fill or {}).get("stars", 0),
        "updated_at": updated_at,
        "language": language,
        "private": bool(g.get("private")) if "private" in g else bool((fill or {}).get("private")),
        "status": "published" if published else "draft",
        "fav": bool((fill or {}).get("fav")),
        "showcase": bool((fill or {}).get("showcase")),
        "netlify_live": netlify_live,
        "netlify_status": netlify_status,
        "thumbnail": (row.get("thumbnail") or "").strip() or (fill or {}).get("thumbnail") or "",
        "slug": slug,
    }
    if tech:
        project["tech"] = tech
    if links:
        project["links"] = links
    return project


def seed_project_to_item(p: dict) -> dict:
    """Normalize a my-json-database project for gap-fill (already vault-shaped)."""
    return {**p}


def main() -> int:
    csv_path = resolve_input_path(Path(sys.argv[1]) if len(sys.argv) > 1 else CSV_DEFAULT)
    if not csv_path.is_file():
        print(f"Supabase CSV not found: {csv_path}", file=sys.stderr)
        print("Export portfolio_projects from Supabase → CSV, then re-run.", file=sys.stderr)
        return 1

    seed_by_repo: dict[str, dict] = {}
    if SEED.is_file():
        seed_data = json.loads(SEED.read_text(encoding="utf-8"))
        for p in seed_data.get("projects", []):
            r = norm_repo(p.get("repo"))
            if r:
                seed_by_repo[r] = p

    with csv_path.open(newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    projects_by_repo: dict[str, dict] = {}
    supabase_with_repo = 0

    for row in rows:
        repo_key = norm_repo(repo_from_row(row))
        if not repo_key:
            continue
        supabase_with_repo += 1
        fill = seed_by_repo.get(repo_key)
        proj = row_to_project(row, fill)
        if proj:
            projects_by_repo[repo_key] = proj

    # GitHub repos in seed but not in Supabase yet (new projects).
    added_from_seed = 0
    for repo_key, seed_p in seed_by_repo.items():
        if repo_key in projects_by_repo:
            continue
        projects_by_repo[repo_key] = seed_project_to_item(seed_p)
        added_from_seed += 1

    for item in SUPPLEMENTAL:
        repo_key = norm_repo(item["repo"])
        if not repo_key:
            continue
        if repo_key in projects_by_repo:
            projects_by_repo[repo_key] = {**projects_by_repo[repo_key], **{k: v for k, v in item.items() if v}}
        else:
            projects_by_repo[repo_key] = item

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

    published = sum(1 for p in projects if p.get("status") == "published" and not p.get("private"))
    print(f"Wrote {len(projects)} projects to {OUT}")
    print(f"  Supabase rows with repo: {supabase_with_repo}")
    print(f"  Added from GitHub seed (not in Supabase): {added_from_seed}")
    print(f"  Published + public (approx CDN after export): {published}")
    print("Next: npm run data:fix-image-urls && npm run data:encrypt")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
