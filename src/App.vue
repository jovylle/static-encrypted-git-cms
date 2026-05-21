<script setup>
import { ref, watch } from 'vue';
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
</script>

<template>
  <div class="vault">
    <header>
      <h1>Static Encrypted CMS</h1>
      <p>Public JSON slice from <code>/data/*.json</code> (build-time export).</p>
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
      <pre>{{ JSON.stringify(previewData, null, 2) }}</pre>
    </section>
    <footer>
      <a href="/admin/">Decap CMS</a> (local: <code>npm run cms</code>)
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
