<script setup>
import { computed, ref, watch } from 'vue';
import { filterPublicList } from './composables/usePublicData.js';

const endpoints = [
  { label: 'Projects', url: '/data/projects.json' },
  { label: 'Personal projects', url: '/data/personal-projects.json' },
  { label: 'Highlights', url: '/data/highlights.json' },
  { label: 'Profile', url: '/data/profile.json' },
  { label: 'Resume', url: '/data/resume.json' },
  { label: 'Blog index', url: '/data/blogs/index.json' },
];

const active = ref(endpoints[0]);
const previewData = ref(null);
const previewError = ref(null);
const previewLoading = ref(true);

async function load(url) {
  previewLoading.value = true;
  previewError.value = null;
  previewData.value = null;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    let json = await r.json();
    if (json.projects) json = filterPublicList(json, 'projects');
    previewData.value = json;
  } catch (e) {
    previewError.value = e.message;
  } finally {
    previewLoading.value = false;
  }
}

watch(active, (ep) => load(ep.url), { immediate: true });

function select(ep) {
  active.value = ep;
}

function absoluteApiUrl(path) {
  if (typeof window === 'undefined') return path;
  return `${window.location.origin}${path}`;
}

const activeApiUrl = computed(() => absoluteApiUrl(active.value.url));

/** Rows for list-shaped public JSON (projects, personal-projects, blog index). */
const listRows = computed(() => {
  const data = previewData.value;
  if (!data) return [];

  if (active.value.url === '/data/blogs/index.json' && Array.isArray(data)) {
    return data.map((post) => ({
      key: post.slug,
      label: post.title || post.slug,
      apiPath: `/data/blogs/${post.slug}.json`,
    }));
  }

  if (Array.isArray(data.projects)) {
    return data.projects.map((p) => ({
      key: p.slug || p.id || p.title,
      label: p.title || p.slug || String(p.id),
      apiPath: active.value.url,
      meta: p.slug ? `slug: ${p.slug}` : p.id != null ? `id: ${p.id}` : '',
    }));
  }

  return [];
});
</script>

<template>
  <div class="vault">
    <header>
      <h1>Static Encrypted CMS</h1>
      <p>
        File database preview — public slice from <code>/data/*.json</code> (build-time export).
        Edit <code>data/source/</code>, then <code>npm run data:save</code>.
      </p>
    </header>
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

      <ul v-if="listRows.length" class="item-list">
        <li v-for="row in listRows" :key="row.key">
          <span class="item-label">{{ row.label }}</span>
          <span v-if="row.meta" class="item-meta">{{ row.meta }}</span>
          <a class="item-api" :href="row.apiPath" target="_blank" rel="noopener">{{
            absoluteApiUrl(row.apiPath)
          }}</a>
        </li>
      </ul>

      <details class="json-details">
        <summary>Raw JSON</summary>
        <pre>{{ JSON.stringify(previewData, null, 2) }}</pre>
      </details>
    </section>
    <footer>
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
</style>
