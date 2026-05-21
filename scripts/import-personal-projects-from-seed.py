#!/usr/bin/env python3
"""
Restore data/source/personal-projects.json from my-json-database (pocket.uft1.com source).

Use this for the full GitHub-synced list with netlify/thumbnail metadata.
For Supabase portfolio CSV (smaller curated list), use import-portfolio-projects-csv.py instead.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEED = ROOT.parent / "my-json-database" / "public" / "data" / "personal-projects.json"
OUT = ROOT / "data" / "source" / "personal-projects.json"

VAULT_REPO = {
    "slug": "static-encrypted-git-cms",
    "title": "static-encrypted-git-cms",
    "description": "Encrypted JSON content vault - git holds ciphertext; CDN serves public /data slice.",
    "repo": "https://github.com/jovylle/static-encrypted-git-cms",
    "stars": 0,
    "updated_at": "2026-05-21T12:00:00Z",
    "language": "JavaScript",
    "private": False,
    "status": "published",
    "fav": False,
    "showcase": False,
    "netlify_live": "content.jovylle.com",
    "netlify_status": "current",
    "thumbnail": "",
}


def norm(url: str | None) -> str:
    return (url or "").strip().rstrip("/").lower()


def main() -> int:
    seed_path = Path(sys.argv[1]) if len(sys.argv) > 1 else SEED
    if not seed_path.is_file():
        print(f"Seed not found: {seed_path}", file=sys.stderr)
        print("Expected my-json-database at:", SEED.parent.parent.parent, file=sys.stderr)
        return 1

    data = json.loads(seed_path.read_text(encoding="utf-8"))
    projects = list(data.get("projects", []))
    key = norm(VAULT_REPO["repo"])
    by_repo = {norm(p.get("repo")): i for i, p in enumerate(projects)}

    if key in by_repo:
        i = by_repo[key]
        projects[i] = {**projects[i], **{k: v for k, v in VAULT_REPO.items() if v}}
        print("Updated static-encrypted-git-cms")
    else:
        projects.append(VAULT_REPO)
        print("Added static-encrypted-git-cms")

    projects.sort(key=lambda p: p.get("updated_at") or "", reverse=True)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps({"projects": projects}, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(projects)} projects to {OUT}")
    print("Next: npm run data:encrypt")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
