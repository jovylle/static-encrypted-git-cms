import { ref } from 'vue';

function isPublicItem(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.status === 'draft') return false;
  if (item.private === true) return false;
  return true;
}

/** Defense-in-depth filter for list-shaped JSON (projects, personal-projects). */
export function filterPublicList(data, listKey = 'projects') {
  if (!data || !Array.isArray(data[listKey])) return data;
  return { ...data, [listKey]: data[listKey].filter(isPublicItem) };
}

export async function loadPublicJson(url) {
  if (import.meta.env.SSR) {
    const { readPublicJsonFromFs } = await import('./readPublicJson.server.js');
    return readPublicJsonFromFs(url);
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

export function usePublicData(url) {
  const data = ref(null);
  const error = ref(null);
  const loading = ref(true);

  loadPublicJson(url)
    .then((json) => {
      if (json.projects) {
        data.value = filterPublicList(json, 'projects');
      } else {
        data.value = json;
      }
    })
    .catch((e) => {
      error.value = e.message;
    })
    .finally(() => {
      loading.value = false;
    });

  return { data, error, loading };
}
