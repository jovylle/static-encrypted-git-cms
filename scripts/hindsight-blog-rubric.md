# Blog-worthiness rubric (source of truth)

This file is the canonical rubric. The copy inside Hindsight
(directive `blog-worthiness-rubric`) is a runtime cache — kept in sync by
`scripts/hindsight-seed-rubric.mjs`, which verifies a content hash post-write.
Never edit the rubric in the Hindsight UI; edit here and re-run the seed script.

## Scoring (0–10, five axes, 0–2 each)

1. **Novel (2)** — not duplicating existing slugs/titles in `data/source/blogs/`,
   not repeating recent Hindsight docs verbatim, has a new angle.
2. **Audience value (2)** — reader can *do* or *learn* something (tutorial,
   pattern, tradeoff, benchmark), not just a personal log.
3. **Portfolio fit (2)** — maps to existing tags (`ai`, `hermes`, `herdr`,
   `opencode`, `cloudflare-pages`, etc.), fits the jovylle.com narrative,
   has a repo / live link / demo.
4. **Privacy/safety (2)** — no secrets, PII, tailnet IPs (`100.x`), API keys,
   vault ciphertext, or internal homelab hostnames. Flag risks explicitly.
5. **Effort/depth (2)** — can sustain 800+ words plus code or screenshots,
   not two paragraphs; has a falsifiable core claim.

## Thresholds

- `<7` — skip, not worth drafting.
- `7–8` — draft candidate.
- `≥9` — strong candidate (highlight, still draft — never auto-publish).

## Output contract

Every evaluation returns `{score, axis_scores:{novel,audience,portfolio,privacy,effort}, reason, risks, suggested_slug}`.
Deduplicate `suggested_slug` against existing `data/source/blogs/*.json` slugs.
