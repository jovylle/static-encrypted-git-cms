<script setup>
const API_BASE = 'https://content-api.jovyllebermudez.workers.dev';

const sections = [
  {
    heading: 'Health',
    desc: 'Readiness check for the API.',
    endpoints: [
      { method: 'GET', path: '/api/health', auth: false, category: 'read', desc: 'Returns { status: "ok", timestamp }.' },
    ],
  },
  {
    heading: 'Feature flags',
    desc: 'Feature toggles consumed by frontend apps. Public read, admin write.',
    endpoints: [
      { method: 'GET', path: '/api/feature-flags', auth: false, category: 'read', desc: 'List all feature flags.' },
      { method: 'GET', path: '/api/feature-flags/:key', auth: false, category: 'read', desc: 'Get a single flag by key.' },
      { method: 'POST', path: '/api/feature-flags', auth: true, category: 'write', desc: 'Create a flag. Body: { key, enabled?, description? }' },
      { method: 'PUT', path: '/api/feature-flags/:key', auth: true, category: 'write', desc: 'Update a flag. Body: { enabled?, description? }' },
      { method: 'DELETE', path: '/api/feature-flags/:key', auth: true, category: 'write', desc: 'Delete a flag.' },
    ],
  },
  {
    heading: 'Contact submissions',
    desc: 'Contact forms. Public submit, admin manage.',
    endpoints: [
      { method: 'POST', path: '/api/contacts', auth: false, category: 'write', desc: 'Submit a message. Body: { name, email, subject?, message }' },
      { method: 'GET', path: '/api/contacts', auth: true, category: 'read', desc: 'List submissions.' },
      { method: 'GET', path: '/api/contacts/:id', auth: true, category: 'read', desc: 'Get single submission.' },
      { method: 'PUT', path: '/api/contacts/:id', auth: true, category: 'write', desc: 'Update status. Body: { status: "unread"|"read"|"replied"|"spam" }' },
      { method: 'DELETE', path: '/api/contacts/:id', auth: true, category: 'write', desc: 'Delete a submission.' },
    ],
  },
  {
    heading: 'Conversations & Messages',
    desc: 'AI chat threads. Public create + message, admin manage.',
    endpoints: [
      { method: 'GET', path: '/api/conversations', auth: false, category: 'read', desc: 'List conversations.' },
      { method: 'POST', path: '/api/conversations', auth: false, category: 'write', desc: 'Start a conversation. Body: { message, title? }' },
      { method: 'GET', path: '/api/conversations/:id', auth: false, category: 'read', desc: 'Get conversation with messages.' },
      { method: 'POST', path: '/api/conversations/:id/messages', auth: false, category: 'write', desc: 'Add message. Body: { role?, content }' },
      { method: 'PUT', path: '/api/conversations/:id', auth: true, category: 'write', desc: 'Update title. Body: { title }' },
      { method: 'DELETE', path: '/api/conversations/:id', auth: true, category: 'write', desc: 'Delete conversation + messages.' },
    ],
  },
  {
    heading: 'Comments',
    desc: 'User comments with admin approval workflow.',
    endpoints: [
      { method: 'GET', path: '/api/comments?target_type=&target_id=', auth: false, category: 'read', desc: 'List approved comments for a target.' },
      { method: 'POST', path: '/api/comments', auth: false, category: 'write', desc: 'Submit comment (status: pending). Body: { target_type, target_id, author_name, author_email?, content }' },
      { method: 'GET', path: '/api/comments/all', auth: true, category: 'read', desc: 'List all comments for moderation.' },
      { method: 'PUT', path: '/api/comments/:id', auth: true, category: 'write', desc: 'Approve/reject. Body: { status: "approved"|"rejected"|"spam" }' },
      { method: 'DELETE', path: '/api/comments/:id', auth: true, category: 'write', desc: 'Delete a comment.' },
    ],
  },
  {
    heading: 'Likes',
    desc: 'Deduplicated likes per visitor per target.',
    endpoints: [
      { method: 'POST', path: '/api/likes/toggle', auth: false, category: 'write', desc: 'Toggle like on/off. Body: { target_type, target_id, visitor_id }' },
      { method: 'GET', path: '/api/likes/count?target_type=&target_id=', auth: false, category: 'read', desc: 'Get like count.' },
    ],
  },
  {
    heading: 'To-dos',
    desc: 'Admin task management.',
    endpoints: [
      { method: 'GET', path: '/api/todos', auth: true, category: 'read', desc: 'List all todos.' },
      { method: 'POST', path: '/api/todos', auth: true, category: 'write', desc: 'Create todo. Body: { title, content?, status?, priority? }' },
      { method: 'GET', path: '/api/todos/:id', auth: true, category: 'read', desc: 'Get a single todo.' },
      { method: 'PUT', path: '/api/todos/:id', auth: true, category: 'write', desc: 'Update todo. Body: { title?, content?, status?, priority? }' },
      { method: 'DELETE', path: '/api/todos/:id', auth: true, category: 'write', desc: 'Delete a todo.' },
    ],
  },
  {
    heading: 'Audit logs',
    desc: 'Immutable audit trail of admin actions.',
    endpoints: [
      { method: 'GET', path: '/api/audit-logs', auth: true, category: 'read', desc: 'List recent audit entries (last 100).' },
    ],
  },
];

const rateLimits = [
  { category: 'auth', limit: 10, window: '1 min' },
  { category: 'read', limit: 60, window: '1 min' },
  { category: 'write', limit: 30, window: '1 min' },
];

function methodClass(method) {
  return method.toLowerCase();
}
</script>

<template>
  <div class="api-docs">
    <h2>Dynamic API Reference</h2>
    <p class="api-docs-intro">
      Powered by Cloudflare Workers + D1. Base URL:
      <code class="base-url">{{ API_BASE }}</code>
    </p>

    <section class="api-overview">
      <h3>Overview</h3>
      <p>
        The Dynamic API provides low-latency endpoints for non-static content —
        feature flags, contact form submissions, comments, likes, AI conversations,
        to-dos, and audit logs. All data lives in a remote D1 database (SQLite,
        APAC region) and is accessed through a Cloudflare Worker.
      </p>
      <h4>Auth</h4>
      <p>
        <strong>Public</strong> endpoints require no authentication.
        <strong>Admin</strong> endpoints use
        <code>Authorization: Basic &lt;base64(admin:password)&gt;</code> or
        an <code>admin_session</code> cookie obtained via login.
        Password comparison is timing-safe.
      </p>
      <h4>Rate limiting</h4>
      <p>Per-IP in-memory rate limiting by category:</p>
      <table class="rate-table">
        <thead>
          <tr><th>Category</th><th>Max requests</th><th>Window</th></tr>
        </thead>
        <tbody>
          <tr v-for="rl in rateLimits" :key="rl.category">
            <td>{{ rl.category }}</td>
            <td>{{ rl.limit }}</td>
            <td>{{ rl.window }}</td>
          </tr>
        </tbody>
      </table>
      <h4>Error responses</h4>
      <p>
        All errors return JSON: <code>{ "error": "&lt;message&gt;" }</code>.
        Common status codes: 400 (bad request), 401 (unauthorized), 404 (not found),
        409 (conflict), 429 (rate limited), 500 (server error).
      </p>
    </section>

    <section v-for="sec in sections" :key="sec.heading" class="api-group">
      <h3 :id="sec.heading.toLowerCase().replace(/\s+/g, '-')">{{ sec.heading }}</h3>
      <p class="group-desc">{{ sec.desc }}</p>
      <table class="endpoint-table">
        <thead>
          <tr>
            <th>Method</th>
            <th>Path</th>
            <th>Auth</th>
            <th>Rate</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="ep in sec.endpoints" :key="ep.path">
            <td><span class="method-tag" :class="methodClass(ep.method)">{{ ep.method }}</span></td>
            <td><code>{{ ep.path }}</code></td>
            <td>{{ ep.auth ? 'Admin' : '—' }}</td>
            <td>{{ ep.category }}</td>
            <td>{{ ep.desc }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="api-group">
      <h3>Example: cURL</h3>
      <pre class="curl-example"># List feature flags (public)
curl {{ API_BASE }}/api/feature-flags

# Create a feature flag (admin)
curl -X POST {{ API_BASE }}/api/feature-flags \
  -H 'Authorization: Basic YWRtaW46eW91ci1wYXNzd29yZA==' \
  -H 'Content-Type: application/json' \
  -d '{"key":"dark-mode","enabled":true}'

# Submit a contact form (public)
curl -X POST {{ API_BASE }}/api/contacts \
  -H 'Content-Type: application/json' \
  -d '{"name":"John","email":"john@example.com","message":"Hello!"}'

# Toggle a like (public)
curl -X POST {{ API_BASE }}/api/likes/toggle \
  -H 'Content-Type: application/json' \
  -d '{"target_type":"blog","target_id":"post-1","visitor_id":"user-abc"}'

# List audit logs (admin)
curl {{ API_BASE }}/api/audit-logs \
  -H 'Authorization: Basic YWRtaW46eW91ci1wYXNzd29yZA=='</pre>
    </section>
  </div>
</template>

<style scoped>
.api-docs { max-width: 960px; }
.api-docs h2 { margin: 0 0 0.25rem; }
.api-docs-intro { margin: 0.25rem 0 1.25rem; font-size: 0.95rem; }
.base-url { font-weight: 600; background: #f0f0f0; padding: 0.15rem 0.4rem; border-radius: 3px; }

.api-overview { margin: 0 0 1.5rem; }
.api-overview h3 { margin: 0 0 0.5rem; }
.api-overview h4 { margin: 1rem 0 0.25rem; font-size: 0.95rem; }
.api-overview p { margin: 0 0 0.5rem; font-size: 0.92rem; line-height: 1.5; color: #333; }

.rate-table { width: auto; min-width: 280px; font-size: 0.86rem; border-collapse: collapse; margin: 0.5rem 0 1rem; }
.rate-table th, .rate-table td { padding: 0.35rem 0.75rem; border: 1px solid #ddd; text-align: left; }
.rate-table th { background: #f5f5f5; }
.rate-table td:first-child { font-weight: 600; }

.api-group { margin: 0 0 1.75rem; }
.api-group h3 { margin: 0 0 0.25rem; }
.group-desc { margin: 0 0 0.75rem; font-size: 0.9rem; color: #555; }

.endpoint-table { width: 100%; font-size: 0.85rem; border-collapse: collapse; }
.endpoint-table th, .endpoint-table td { padding: 0.4rem 0.6rem; border-bottom: 1px solid #eee; text-align: left; vertical-align: top; }
.endpoint-table th { background: #f8f8f8; position: sticky; top: 0; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.03em; color: #555; }
.endpoint-table td:last-child { font-size: 0.83rem; color: #444; }

.method-tag { display: inline-block; font-size: 0.75rem; font-weight: 700; padding: 0.15rem 0.45rem; border-radius: 3px; color: #fff; min-width: 4em; text-align: center; }
.method-tag.get { background: #2e7d32; }
.method-tag.post { background: #1565c0; }
.method-tag.put { background: #e65100; }
.method-tag.delete { background: #c62828; }

.curl-example { background: #1e1e2e; color: #cdd6f4; padding: 1rem; border-radius: 6px; font-size: 0.82rem; overflow: auto; line-height: 1.6; }
</style>
