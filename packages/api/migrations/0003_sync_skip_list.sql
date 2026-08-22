-- GitHub repo sync-check skip list (admin marks repos to never sync into personal-projects)
CREATE TABLE IF NOT EXISTS sync_skip_list (
  repo_url TEXT PRIMARY KEY,
  reason TEXT DEFAULT '',
  skipped_at TEXT DEFAULT (datetime('now'))
);
