<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { filterPublicList } from './composables/usePublicData.js';

const endpoints = [
  { label: 'Projects', url: '/data/projects.json' },
  { label: 'Personal projects', url: '/data/personal-projects.json' },
  { label: 'Highlights', url: '/data/highlights.json' },
  { label: 'Profile', url: '/data/profile.json' },
  { label: 'Resume', url: '/data/resume.json' },
  { label: 'Notifications', url: '/data/notifications.json' },
  { label: 'Blog index', url: '/data/blogs/index.json' },
];

const DOCS_ADDING_CONTENT =
  'https://github.com/jovylle/static-encrypted-git-cms/blob/master/docs/ADDING-CONTENT.md';
const TEMPLATE_BLOG =
  'https://github.com/jovylle/static-encrypted-git-cms/blob/master/data/templates/blog-post.json';
const TEMPLATE_NOTIFICATION =
  'https://github.com/jovylle/static-encrypted-git-cms/blob/master/data/templates/notification.json';

const active = ref(endpoints[0]);
const previewData = ref(null);
const previewError = ref(null);
const previewLoading = ref(true);
const searchQuery = ref('');

const homeBlogs = ref([]);
const homeNotifications = ref([]);
const homeFeedError = ref(null);
const homeFeedLoading = ref(true);

async function load(url) {
  previewLoading.value = true;
  previewError.value = null;
  previewData.value = null;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    let json = await r.json();
    if (json.projects) json = filterPublicList(json, 'projects');
    if (json.notifications) json = filterPublicList(json, 'notifications');
    previewData.value = json;
  } catch (e) {
    previewError.value = e.message;
  } finally {
    previewLoading.value = false;
  }
}

async function loadHomeFeed() {
  homeFeedLoading.value = true;
  homeFeedError.value = null;
  homeBlogs.value = [];
  homeNotifications.value = [];
  try {
    const [blogRes, notifRes] = await Promise.all([
      fetch('/data/blogs/index.json'),
      fetch('/data/notifications.json'),
    ]);
    if (blogRes.ok) {
      const posts = await blogRes.json();
      homeBlogs.value = Array.isArray(posts) ? posts.slice(0, 5) : [];
    }
    if (notifRes.ok) {
      const data = await notifRes.json();
      const list = filterPublicList(data, 'notifications').notifications || [];
      homeNotifications.value = list.slice(0, 5);
    }
  } catch (e) {
    homeFeedError.value = e.message;
  } finally {
    homeFeedLoading.value = false;
  }
}

onMounted(loadHomeFeed);

watch(active, (ep) => load(ep.url), { immediate: true });

function select(ep) {
  active.value = ep;
  searchQuery.value = '';
}

function absoluteApiUrl(path) {
  if (typeof window === 'undefined') return path;
  return `${window.location.origin}${path}`;
}

const activeApiUrl = computed(() => absoluteApiUrl(active.value.url));

const listRows = computed(() => {
  const data = previewData.value;
  if (!data) return [];

  let rows = [];

  if (active.value.url === '/data/blogs/index.json' && Array.isArray(data)) {
    rows = data.map((post) => ({
      key: post.slug,
      label: post.title || post.slug,
      apiPath: `/data/blogs/${post.slug}.json`,
    }));
  } else if (Array.isArray(data.projects)) {
    rows = data.projects.map((p) => ({
      key: p.slug || p.id || p.title,
      label: p.title || p.slug || String(p.id),
      apiPath: active.value.url,
      meta: p.slug ? `slug: ${p.slug}` : p.id != null ? `id: ${p.id}` : '',
    }));
  } else if (Array.isArray(data.notifications)) {
    rows = data.notifications.map((n) => ({
      key: n.id || n.title,
      label: n.title || n.id,
      apiPath: active.value.url,
      meta: n.type ? `type: ${n.type}` : '',
    }));
  }

  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => {
    const haystack = [row.label, row.key, row.meta].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(q);
  });
});

function formatCellValue(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

const tableView = computed(() => {
  const data = previewData.value;
  if (!data) return null;

  const rowSource = Array.isArray(data)
    ? data
    : Array.isArray(data.projects)
      ? data.projects
      : Array.isArray(data.notifications)
        ? data.notifications
        : null;

  if (rowSource && rowSource.every((row) => row && typeof row === 'object' && !Array.isArray(row))) {
    const columns = [];
    const seen = new Set();

    for (const row of rowSource) {
      for (const key of Object.keys(row)) {
        if (seen.has(key)) continue;
        seen.add(key);
        columns.push(key);
      }
    }

    const q = searchQuery.value.trim().toLowerCase();
    const filteredRows = q
      ? rowSource.filter((row) =>
          columns.some((column) => formatCellValue(row[column]).toLowerCase().includes(q)),
        )
      : rowSource;

    return {
      type: 'rows',
      columns,
      rows: filteredRows.map((row) => {
        const out = {};
        for (const column of columns) out[column] = formatCellValue(row[column]);
        return out;
      }),
    };
  }

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return {
      type: 'kv',
      entries: Object.entries(data).map(([key, value]) => ({
        key,
        value: formatCellValue(value),
      })),
    };
  }

  return {
    type: 'single',
    value: formatCellValue(data),
  };
});
</script>

<template>
  <div class="vault">
    <header>
      <h1>Static Encrypted CMS</h1>
      <p>
        File database preview — public slice from <code>/data/*.json</code> (build-time export).
        Edit via <a href="/admin/">/admin</a> or <code>data/source/</code>, then
        <code>npm run data:save</code>.
      </p>
    </header>

    <section class="home-feed" aria-labelledby="home-feed-title">
      <div class="home-feed-header">
        <h2 id="home-feed-title">Latest blogs &amp; notifications</h2>
        <p class="home-feed-docs">
          <a :href="DOCS_ADDING_CONTENT" target="_blank" rel="noopener">How to add content</a>
          ·
          <a :href="TEMPLATE_BLOG" target="_blank" rel="noopener">Blog template</a>
          ·
          <a :href="TEMPLATE_NOTIFICATION" target="_blank" rel="noopener">Notification template</a>
        </p>
      </div>

      <p v-if="homeFeedLoading" class="muted">Loading home feed…</p>
      <p v-else-if="homeFeedError" class="error">{{ homeFeedError }}</p>
      <div v-else class="home-feed-grid">
        <div class="feed-panel">
          <h3>Recent blog posts</h3>
          <ul v-if="homeBlogs.length" class="feed-list">
            <li v-for="post in homeBlogs" :key="post.slug">
              <strong>{{ post.title || post.slug }}</strong>
              <span v-if="post.date" class="feed-meta">{{ post.date }}</span>
              <a
                class="feed-link"
                :href="absoluteApiUrl(`/data/blogs/${post.slug}.json`)"
                target="_blank"
                rel="noopener"
                >JSON</a
              >
            </li>
          </ul>
          <p v-else class="muted">No published blog posts in export.</p>
          <button type="button" class="feed-tab-btn" @click="select(endpoints.find((e) => e.url.includes('blogs')))">
            Browse all blogs
          </button>
        </div>

        <div class="feed-panel">
          <h3>Notifications</h3>
          <ul v-if="homeNotifications.length" class="feed-list">
            <li v-for="item in homeNotifications" :key="item.id">
              <strong>{{ item.title }}</strong>
              <span class="feed-message">{{ item.message }}</span>
              <a
                v-if="item.link?.url"
                class="feed-link"
                :href="item.link.url"
                target="_blank"
                rel="noopener"
                >{{ item.link.label || 'Link' }}</a
              >
            </li>
          </ul>
          <p v-else class="muted">No published notifications in export.</p>
          <button
            type="button"
            class="feed-tab-btn"
            @click="select(endpoints.find((e) => e.url.includes('notifications')))"
          >
            Browse notifications
          </button>
        </div>
      </div>
    </section>

    <nav>
      <button
        v-for="ep in endpoints"
        :key="ep.url"
        :class="{ active: active.url === ep.url }"
        @click="select(ep)"
      >
        {{ ep.label }}
      </button>
    </nav>
    <section v-if="previewLoading">Loading…</section>
    <section v-else-if="previewError" class="error">{{ previewError }}</section>
    <section v-else>
      <h2>{{ active.label }}</h2>
      <p class="api-endpoint">
        API:
        <a :href="active.url" target="_blank" rel="noopener">{{ activeApiUrl }}</a>
      </p>

      <div v-if="listRows.length || tableView?.type === 'rows'" class="search-bar">
        <input
          v-model="searchQuery"
          type="search"
          placeholder="Filter rows…"
          aria-label="Filter rows"
        />
      </div>

      <ul v-if="listRows.length" class="item-list">
        <li v-for="row in listRows" :key="row.key">
          <span class="item-label">{{ row.label }}</span>
          <span v-if="row.meta" class="item-meta">{{ row.meta }}</span>
          <a class="item-api" :href="row.apiPath" target="_blank" rel="noopener">{{
            absoluteApiUrl(row.apiPath)
          }}</a>
        </li>
      </ul>

      <div v-if="tableView" class="table-wrap">
        <table v-if="tableView.type === 'rows'" class="json-table">
          <thead>
            <tr>
              <th v-for="column in tableView.columns" :key="column">{{ column }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, rowIndex) in tableView.rows" :key="rowIndex">
              <td v-for="column in tableView.columns" :key="`${rowIndex}-${column}`">
                {{ row[column] }}
              </td>
            </tr>
          </tbody>
        </table>

        <table v-else-if="tableView.type === 'kv'" class="json-table kv-table">
          <thead>
            <tr>
              <th>Key</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in tableView.entries" :key="entry.key">
              <td class="kv-key">{{ entry.key }}</td>
              <td>{{ entry.value }}</td>
            </tr>
          </tbody>
        </table>

        <table v-else class="json-table kv-table">
          <thead>
            <tr>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{{ tableView.value }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <details class="json-details">
        <summary>Raw JSON</summary>
        <pre>{{ JSON.stringify(previewData, null, 2) }}</pre>
      </details>
    </section>
    <footer>
      <a href="/admin/">Content admin</a>
      <span aria-hidden="true"> · </span>
      <a :href="DOCS_ADDING_CONTENT" target="_blank" rel="noopener">Adding blogs &amp; notifications</a>
      <span aria-hidden="true"> · </span>
      <a href="https://github.com/jovylle/static-encrypted-git-cms/blob/master/docs/DATABASE.md" target="_blank" rel="noopener">File database docs</a>
    </footer>
  </div>
</template>

<style>
.vault {
  font-family: system-ui, sans-serif;
  max-width: 960px;
  margin: 0 auto;
  padding: 1.5rem;
}
header h1 {
  margin: 0 0 0.25rem;
}
.home-feed {
  margin: 1.25rem 0 1.5rem;
  padding: 1rem 1.1rem;
  border: 1px solid #ddd;
  border-radius: 8px;
  background: #fafafa;
}
.home-feed-header {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 1rem;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 0.85rem;
}
.home-feed-header h2 {
  margin: 0;
  font-size: 1.15rem;
}
.home-feed-docs {
  margin: 0;
  font-size: 0.88rem;
}
.home-feed-grid {
  display: grid;
  gap: 1rem;
}
@media (min-width: 640px) {
  .home-feed-grid {
    grid-template-columns: 1fr 1fr;
  }
}
.feed-panel h3 {
  margin: 0 0 0.5rem;
  font-size: 0.95rem;
}
.feed-list {
  list-style: none;
  padding: 0;
  margin: 0 0 0.65rem;
}
.feed-list li {
  padding: 0.45rem 0;
  border-bottom: 1px solid #eee;
  display: grid;
  gap: 0.15rem;
}
.feed-list li:last-child {
  border-bottom: none;
}
.feed-meta {
  font-size: 0.8rem;
  color: #666;
}
.feed-message {
  font-size: 0.88rem;
  color: #444;
}
.feed-link {
  font-size: 0.82rem;
}
.feed-tab-btn {
  padding: 0.35rem 0.65rem;
  font: inherit;
  cursor: pointer;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: #fff;
}
.muted {
  color: #666;
  font-size: 0.9rem;
}
nav {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 1rem 0;
}
nav button {
  padding: 0.4rem 0.75rem;
  cursor: pointer;
  border: 1px solid #ccc;
  background: #f5f5f5;
  border-radius: 4px;
}
nav button.active {
  background: #1a1a2e;
  color: #fff;
  border-color: #1a1a2e;
}
.api-endpoint {
  margin: 0.25rem 0 1rem;
  font-size: 0.95rem;
}
.api-endpoint a {
  word-break: break-all;
}
.search-bar {
  margin: 0 0 1rem;
}
.search-bar input {
  width: 100%;
  max-width: 320px;
  padding: 0.45rem 0.6rem;
  border: 1px solid #ccc;
  border-radius: 6px;
  font: inherit;
}
.item-list {
  list-style: none;
  padding: 0;
  margin: 0 0 1rem;
  border: 1px solid #ddd;
  border-radius: 6px;
  max-height: 40vh;
  overflow: auto;
}
.item-list li {
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid #eee;
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 1rem;
  align-items: baseline;
}
.item-list li:last-child {
  border-bottom: none;
}
.item-label {
  font-weight: 600;
  flex: 1 1 12rem;
}
.item-meta {
  font-size: 0.8rem;
  color: #666;
}
.item-api {
  font-size: 0.8rem;
  word-break: break-all;
}
.json-details summary {
  cursor: pointer;
  margin-bottom: 0.5rem;
  color: #444;
}
.table-wrap {
  margin: 1rem 0;
  max-height: 60vh;
  overflow: auto;
  border: 1px solid #ddd;
  border-radius: 6px;
}
.json-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.86rem;
}
.json-table th,
.json-table td {
  border-bottom: 1px solid #eee;
  padding: 0.45rem 0.6rem;
  text-align: left;
  vertical-align: top;
  white-space: pre-wrap;
  word-break: break-word;
}
.json-table thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: #f8f8f8;
}
.kv-table .kv-key {
  font-weight: 600;
  white-space: nowrap;
  width: 28%;
}
pre {
  background: #f0f0f0;
  padding: 1rem;
  overflow: auto;
  font-size: 0.8rem;
  max-height: 60vh;
}
.error {
  color: #b00020;
}
footer {
  margin-top: 2rem;
  font-size: 0.9rem;
  color: #666;
}
footer a {
  color: inherit;
}
</style>
