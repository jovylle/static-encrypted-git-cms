import { describe, it, expect, beforeAll } from 'vitest';
import { SELF, env } from 'cloudflare:test';

const BASE = 'http://localhost';
const ADMIN = { authorization: 'Basic ' + btoa('admin:test-password') };

const SETUP_SQL = [
  `CREATE TABLE IF NOT EXISTS feature_flags (
    id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE,
    enabled INTEGER NOT NULL DEFAULT 0, description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS contact_submissions (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL,
    subject TEXT, message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'unread',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL,
    target_type TEXT, target_id TEXT, metadata TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY, title TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY, target_type TEXT NOT NULL, target_id TEXT NOT NULL,
    author_name TEXT NOT NULL, author_email TEXT, content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS likes (
    id TEXT PRIMARY KEY, target_type TEXT NOT NULL, target_id TEXT NOT NULL,
    visitor_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(target_type, target_id, visitor_id)
  )`,
  `CREATE TABLE IF NOT EXISTS todos (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    priority INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
];

beforeAll(async () => {
  for (const sql of SETUP_SQL) await env.DB.prepare(sql).run();
});

describe('Feature flags', () => {
  it('lists empty when no flags', async () => {
    const res = await SELF.fetch(`${BASE}/api/feature-flags`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('creates, reads, updates, and deletes a flag', async () => {
    // Create
    const create = await SELF.fetch(`${BASE}/api/feature-flags`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...ADMIN },
      body: JSON.stringify({ key: 'toggle', enabled: true }),
    });
    expect(create.status).toBe(201);
    expect((await create.json() as Record<string, unknown>).key).toBe('toggle');

    // Get by key
    const get = await SELF.fetch(`${BASE}/api/feature-flags/toggle`);
    expect(get.status).toBe(200);
    expect((await get.json() as Record<string, unknown>).key).toBe('toggle');

    // Update
    const upd = await SELF.fetch(`${BASE}/api/feature-flags/toggle`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...ADMIN },
      body: JSON.stringify({ enabled: false }),
    });
    expect(upd.status).toBe(200);
    expect((await upd.json() as Record<string, unknown>).enabled).toBe(0);

    // Delete
    const del = await SELF.fetch(`${BASE}/api/feature-flags/toggle`, {
      method: 'DELETE',
      headers: ADMIN,
    });
    expect(del.status).toBe(200);

    // Verify gone
    const list = await SELF.fetch(`${BASE}/api/feature-flags`);
    expect(await list.json()).toEqual([]);
  });

  it('rejects duplicate key', async () => {
    await SELF.fetch(`${BASE}/api/feature-flags`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...ADMIN },
      body: JSON.stringify({ key: 'dup' }),
    });
    const dup = await SELF.fetch(`${BASE}/api/feature-flags`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...ADMIN },
      body: JSON.stringify({ key: 'dup' }),
    });
    expect(dup.status).toBe(409);
  });

  it('rejects missing key on create', async () => {
    const res = await SELF.fetch(`${BASE}/api/feature-flags`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...ADMIN },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(400);
  });
});

describe('Contacts', () => {
  it('creates submission (public)', async () => {
    const res = await SELF.fetch(`${BASE}/api/contacts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Test', email: 't@t.com', message: 'hello' }),
    });
    expect(res.status).toBe(201);
    expect((await res.json() as Record<string, unknown>).status).toBe('unread');
  });

  it('rejects bad input', async () => {
    const res = await SELF.fetch(`${BASE}/api/contacts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 't@t.com' }),
    });
    expect(res.status).toBe(400);
  });

  it('lists and updates submission (admin)', async () => {
    // Create a submission first
    await SELF.fetch(`${BASE}/api/contacts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Admin Test', email: 'a@a.com', message: 'test' }),
    });

    // List
    const list = await SELF.fetch(`${BASE}/api/contacts`, { headers: ADMIN });
    expect(list.status).toBe(200);
    const items = await list.json() as Record<string, unknown>[];
    expect(items.length).toBe(1);
    const id = items[0].id as string;

    // Update status
    const upd = await SELF.fetch(`${BASE}/api/contacts/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...ADMIN },
      body: JSON.stringify({ status: 'read' }),
    });
    expect(upd.status).toBe(200);
    expect((await upd.json() as Record<string, unknown>).status).toBe('read');
  });
});

describe('Auth', () => {
  it('rejects unauthenticated admin routes', async () => {
    const res = await SELF.fetch(`${BASE}/api/contacts`);
    expect(res.status).toBe(401);
  });

  it('rejects bad password', async () => {
    const res = await SELF.fetch(`${BASE}/api/contacts`, {
      headers: { authorization: 'Basic ' + btoa('admin:wrong') },
    });
    expect(res.status).toBe(401);
  });
});

describe('Audit logs', () => {
  it('requires auth', async () => {
    const res = await SELF.fetch(`${BASE}/api/audit-logs`);
    expect(res.status).toBe(401);
  });

  it('works for admin', async () => {
    // Do an admin action to create an audit log entry
    await SELF.fetch(`${BASE}/api/feature-flags`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...ADMIN },
      body: JSON.stringify({ key: 'audit-test', enabled: true }),
    });

    const res = await SELF.fetch(`${BASE}/api/audit-logs`, { headers: ADMIN });
    expect(res.status).toBe(200);
    const logs = await res.json() as Record<string, unknown>[];
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].action).toBe('feature_flag.create');
  });
});

describe('Conversations', () => {
  it('creates and retrieves a conversation with message', async () => {
    const create = await SELF.fetch(`${BASE}/api/conversations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Hello world' }),
    });
    expect(create.status).toBe(201);
    const created = await create.json() as Record<string, unknown>;
    expect((created.messages as any[])[0].content).toBe('Hello world');

    const get = await SELF.fetch(`${BASE}/api/conversations/${created.id}`);
    expect(get.status).toBe(200);
  });

  it('lists conversations', async () => {
    const create = await SELF.fetch(`${BASE}/api/conversations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Hi', title: 'Test' }),
    });
    expect(create.status).toBe(201);

    const list = await SELF.fetch(`${BASE}/api/conversations`);
    expect(list.status).toBe(200);
    const items = await list.json() as Record<string, unknown>[];
    expect(items.length).toBe(1);
    expect(items[0].title).toBe('Test');
  });

  it('adds message to existing conversation', async () => {
    const create = await SELF.fetch(`${BASE}/api/conversations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'First' }),
    });
    const conv = await create.json() as Record<string, unknown>;

    const add = await SELF.fetch(`${BASE}/api/conversations/${conv.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'assistant', content: 'Response' }),
    });
    expect(add.status).toBe(201);
    expect((await add.json() as Record<string, unknown>).role).toBe('assistant');

    const get = await SELF.fetch(`${BASE}/api/conversations/${conv.id}`);
    const full = await get.json() as Record<string, unknown>;
    expect((full.messages as any[]).length).toBe(2);
  });

  it('rejects empty message on create', async () => {
    const res = await SELF.fetch(`${BASE}/api/conversations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('updates title (admin)', async () => {
    const create = await SELF.fetch(`${BASE}/api/conversations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Hey' }),
    });
    const conv = await create.json() as Record<string, unknown>;

    const upd = await SELF.fetch(`${BASE}/api/conversations/${conv.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...ADMIN },
      body: JSON.stringify({ title: 'Updated Title' }),
    });
    expect(upd.status).toBe(200);
    expect((await upd.json() as Record<string, unknown>).title).toBe('Updated Title');
  });

  it('deletes conversation (admin)', async () => {
    const create = await SELF.fetch(`${BASE}/api/conversations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Delete me' }),
    });
    const conv = await create.json() as Record<string, unknown>;

    const del = await SELF.fetch(`${BASE}/api/conversations/${conv.id}`, {
      method: 'DELETE',
      headers: ADMIN,
    });
    expect(del.status).toBe(200);

    const get = await SELF.fetch(`${BASE}/api/conversations/${conv.id}`);
    expect(get.status).toBe(404);
  });
});

describe('Comments', () => {
  it('submits comment (public, pending)', async () => {
    const res = await SELF.fetch(`${BASE}/api/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target_type: 'blog', target_id: 'post-1', author_name: 'Bob', content: 'Nice post!' }),
    });
    expect(res.status).toBe(201);
    expect((await res.json() as Record<string, unknown>).status).toBe('pending');
  });

  it('lists only approved comments', async () => {
    await SELF.fetch(`${BASE}/api/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target_type: 'blog', target_id: 'post-2', author_name: 'Bob', content: 'Pending' }),
    });

    // Should be empty since none approved
    const list = await SELF.fetch(`${BASE}/api/comments?target_type=blog&target_id=post-2`);
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual([]);
  });

  it('approves comment (admin)', async () => {
    const create = await SELF.fetch(`${BASE}/api/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target_type: 'blog', target_id: 'post-3', author_name: 'Bob', content: 'Approve me' }),
    });
    const comment = await create.json() as Record<string, unknown>;

    const upd = await SELF.fetch(`${BASE}/api/comments/${comment.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...ADMIN },
      body: JSON.stringify({ status: 'approved' }),
    });
    expect(upd.status).toBe(200);
    expect((await upd.json() as Record<string, unknown>).status).toBe('approved');
  });

  it('rejects invalid status update', async () => {
    const create = await SELF.fetch(`${BASE}/api/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target_type: 'blog', target_id: 'post-4', author_name: 'Bob', content: 'Test' }),
    });
    const comment = await create.json() as Record<string, unknown>;

    const res = await SELF.fetch(`${BASE}/api/comments/${comment.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...ADMIN },
      body: JSON.stringify({ status: 'invalid' }),
    });
    expect(res.status).toBe(400);
  });

  it('lists all comments (admin)', async () => {
    await SELF.fetch(`${BASE}/api/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target_type: 'blog', target_id: 'admin-list', author_name: 'Admin', content: 'For moderation' }),
    });

    const res = await SELF.fetch(`${BASE}/api/comments/all`, { headers: ADMIN });
    expect(res.status).toBe(200);
    const items = await res.json() as Record<string, unknown>[];
    expect(items.length).toBe(1);
    expect(items[0].status).toBe('pending');
  });
});

describe('Likes', () => {
  it('toggles like on/off', async () => {
    const on = await SELF.fetch(`${BASE}/api/likes/toggle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target_type: 'blog', target_id: 'post-1', visitor_id: 'user-1' }),
    });
    expect(on.status).toBe(200);
    expect((await on.json() as Record<string, unknown>).liked).toBe(true);

    const off = await SELF.fetch(`${BASE}/api/likes/toggle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target_type: 'blog', target_id: 'post-1', visitor_id: 'user-1' }),
    });
    expect((await off.json() as Record<string, unknown>).liked).toBe(false);
  });

  it('returns correct count', async () => {
    await SELF.fetch(`${BASE}/api/likes/toggle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target_type: 'blog', target_id: 'count-post', visitor_id: 'v1' }),
    });
    await SELF.fetch(`${BASE}/api/likes/toggle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target_type: 'blog', target_id: 'count-post', visitor_id: 'v2' }),
    });
    await SELF.fetch(`${BASE}/api/likes/toggle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target_type: 'blog', target_id: 'count-post', visitor_id: 'v3' }),
    });

    const res = await SELF.fetch(`${BASE}/api/likes/count?target_type=blog&target_id=count-post`);
    expect((await res.json() as Record<string, unknown>).count).toBe(3);
  });
});
describe('Todos', () => {
  it('requires auth', async () => {
    const res = await SELF.fetch(`${BASE}/api/todos`);
    expect(res.status).toBe(401);

    const res2 = await SELF.fetch(`${BASE}/api/todos/some-id`);
    expect(res2.status).toBe(401);
  });

  it('creates, reads, updates, and deletes', async () => {
    const create = await SELF.fetch(`${BASE}/api/todos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...ADMIN },
      body: JSON.stringify({ title: 'Test todo', priority: 5 }),
    });
    expect(create.status).toBe(201);
    const created = await create.json() as Record<string, unknown>;
    expect(created.title).toBe('Test todo');
    expect(created.status).toBe('open');
    expect(created.priority).toBe(5);

    const get = await SELF.fetch(`${BASE}/api/todos/${created.id}`, { headers: ADMIN });
    expect(get.status).toBe(200);
    expect((await get.json() as Record<string, unknown>).title).toBe('Test todo');

    const upd = await SELF.fetch(`${BASE}/api/todos/${created.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...ADMIN },
      body: JSON.stringify({ status: 'done' }),
    });
    expect(upd.status).toBe(200);
    expect((await upd.json() as Record<string, unknown>).status).toBe('done');

    const list = await SELF.fetch(`${BASE}/api/todos`, { headers: ADMIN });
    expect(list.status).toBe(200);
    const items = await list.json() as Record<string, unknown>[];
    expect(items.length).toBe(1);

    const del = await SELF.fetch(`${BASE}/api/todos/${created.id}`, {
      method: 'DELETE',
      headers: ADMIN,
    });
    expect(del.status).toBe(200);

    const list2 = await SELF.fetch(`${BASE}/api/todos`, { headers: ADMIN });
    expect((await list2.json() as Record<string, unknown>[]).length).toBe(0);
  });

  it('rejects empty title', async () => {
    const res = await SELF.fetch(`${BASE}/api/todos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...ADMIN },
      body: JSON.stringify({ title: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects invalid status', async () => {
    const todo = await (await SELF.fetch(`${BASE}/api/todos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...ADMIN },
      body: JSON.stringify({ title: 'Bad status' }),
    })).json() as Record<string, unknown>;

    const res = await SELF.fetch(`${BASE}/api/todos/${todo.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...ADMIN },
      body: JSON.stringify({ status: 'invalid' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for nonexistent todo', async () => {
    const res = await SELF.fetch(`${BASE}/api/todos/nonexistent-id`, { headers: ADMIN });
    expect(res.status).toBe(404);
  });
});
describe('404', () => {
  it('returns 404 for unknown routes', async () => {
    const res = await SELF.fetch(`${BASE}/api/nonexistent`);
    expect(res.status).toBe(404);
  });
});
