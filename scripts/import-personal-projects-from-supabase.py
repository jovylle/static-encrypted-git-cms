#!/usr/bin/env python3
"""
Build data/source/personal-projects.json from Supabase portfolio_projects (+ GitHub gap-fill).

Source of truth: Supabase table `portfolio_projects` (priority_score, tech, links, is_published).
Gap-fill: GitHub-synced repos from my-json-database not yet in Supabase.

Input: optional CSV export path (argv[1]). Then:
  npm run data:normalize-personal-projects
  npm run data:validate
  npm run data:encrypt
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
SEED = ROOT.parent / "my-json-database" / "public" / "data" / "personal-projects.json"
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
    g = {}
    try:
        g = json.loads(row.get("github_raw") or "{}")
    except json.JSONDecodeError:
        pass
    return canonical_repo(row.get("repo_url")) or canonical_repo(g.get("html_url"))


def main() -> int:
    csv_path = Path(sys.argv[1]) if len(sys.argv) > 1 else CSV_DEFAULT
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

    added_from_seed = 0
    for repo_key, seed_p in seed_by_repo.items():
        if repo_key in projects_by_repo:
            continue
        projects_by_repo[repo_key] = normalize_project(seed_p)
        added_from_seed += 1

    for item in SUPPLEMENTAL:
        repo_key = norm_repo(item["repo"])
        if not repo_key:
            continue
        base = normalize_project(item)
        if repo_key in projects_by_repo:
            projects_by_repo[repo_key] = {**projects_by_repo[repo_key], **base}
        else:
            projects_by_repo[repo_key] = base

    projects = sorted(
        projects_by_repo.values(),
        key=lambda p: (-(p.get("priority_score") or 0), p.get("updated_at") or ""),
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
    print("Next: npm run data:normalize-personal-projects && npm run data:validate && npm run data:encrypt")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
