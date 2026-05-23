#!/usr/bin/env python3
"""
Import portfolio_projects_rows.csv into data/source/personal-projects.json.

Migration/helper only. Prefer:
  npm run data:import-personal-projects-from-supabase

Uses CSV rows with is_published=true (deduped by repo). Output matches schemas/personal-projects.schema.json.
"""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from lib.personal_project_shape import canonical_repo, norm_repo, normalize_project, row_to_project  # noqa: E402

CSV_DEFAULT = Path(r"d:/TempHome/Downloadss/portfolio_projects_rows.csv")
OUT = ROOT / "data" / "source" / "personal-projects.json"

SUPPLEMENTAL = [
    {
        "slug": "static-encrypted-git-cms",
        "title": "static-encrypted-git-cms",
        "description": "Encrypted JSON content vault - git holds ciphertext; CDN serves public /data slice.",
        "repo": "https://github.com/jovylle/static-encrypted-git-cms",
        "tech": ["JavaScript"],
        "links": [
            {"label": "Repo", "url": "https://github.com/jovylle/static-encrypted-git-cms"},
            {"label": "Live", "url": "https://content.jovylle.com/"},
        ],
        "status": "published",
        "private": False,
        "fav": False,
        "priority_score": 200,
        "updated_at": "2026-05-21T12:00:00Z",
        "thumbnail": "",
    },
]


def repo_from_row(row: dict) -> str | None:
    try:
        g = json.loads(row.get("github_raw") or "{}")
    except json.JSONDecodeError:
        g = {}
    return canonical_repo(row.get("repo_url") or g.get("html_url"))


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
        if proj:
            projects_by_repo[repo_key] = proj

    for item in SUPPLEMENTAL:
        repo_key = norm_repo(item["repo"])
        if not repo_key:
            continue
        projects_by_repo[repo_key] = normalize_project(item)

    projects = sorted(
        projects_by_repo.values(),
        key=lambda p: (-(p.get("priority_score") or 0), p.get("updated_at") or ""),
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
