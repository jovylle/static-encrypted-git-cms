-- Feature flags (public read, admin write)
CREATE TABLE IF NOT EXISTS feature_flags (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Contact form submissions
CREATE TABLE IF NOT EXISTS contact_submissions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  subject TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unread'
    CHECK (status IN ('unread', 'read', 'replied', 'spam')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contacts_status ON contact_submissions(status);

-- AI conversations
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);

-- Comments (admin approval required)
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_email TEXT,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'spam')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_target ON comments(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_comments_status ON comments(status);

-- Likes (deduped per visitor)
CREATE TABLE IF NOT EXISTS likes (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(target_type, target_id, visitor_id)
);
CREATE INDEX IF NOT EXISTS idx_likes_target ON likes(target_type, target_id);

-- Todos
CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'done')),
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status);

-- Audit logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
