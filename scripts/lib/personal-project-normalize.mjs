/**
 * Canonical personal-project shape (see schemas/personal-projects.schema.json).
 * Strips legacy keys: stars, showcase, netlify_live, netlify_status, category, name, live.
 */

const LEGACY_PROJECT_KEYS = new Set([
  'stars',
  'showcase',
  'netlify_live',
  'netlify_status',
  'category',
  'name',
  'live',
]);

/** @param {Record<string, unknown>} item */
export function stripLegacyProjectKeys(item) {
  if (!item || typeof item !== 'object') return item;
  const out = { ...item };
  for (const key of LEGACY_PROJECT_KEYS) {
    delete out[key];
  }
  return out;
}

export function normRepo(url) {
  if (!url || typeof url !== 'string') return null;
  let u = url.trim();
  if (!u.includes('github.com')) return null;
  if (!u.startsWith('http')) u = `https://${u.replace(/^\/+/, '')}`;
  const parts = u.replace(/\/$/, '').toLowerCase().split('/');
  if (parts.length >= 5) return `https://github.com/${parts[3]}/${parts[4]}`;
  return u.replace(/\/$/, '').toLowerCase();
}

function parseTech(value) {
  if (Array.isArray(value)) {
    return value.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim());
  }
  if (typeof value === 'string' && value.trim()) {
    const raw = value.trim();
    if (raw.startsWith('[')) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parseTech(parsed);
      } catch {
        /* fall through */
      }
    }
    return raw.split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function parseLinks(value) {
  if (!value) return [];
  let links = value;
  if (typeof value === 'string') {
    try {
      links = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(links)) return [];
  const out = [];
  const seen = new Set();
  for (const link of links) {
    if (!link || typeof link !== 'object') continue;
    const label = String(link.label || '').trim();
    const url = String(link.url || '').trim();
    if (!label || !url) continue;
    const key = `${label.toLowerCase()}|${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label, url });
  }
  return out;
}

function liveUrlFromHost(host) {
  if (!host || typeof host !== 'string') return null;
  const h = host.trim();
  if (!h || h.toLowerCase() === 'null') return null;
  if (h.startsWith('http://') || h.startsWith('https://')) return h.replace(/\/$/, '') + '/';
  return `https://${h.replace(/\/$/, '')}/`;
}

export function buildLinks(raw, repo) {
  const parsed = parseLinks(raw.links);
  if (parsed.length) return parsed;

  const links = [];
  if (repo) links.push({ label: 'Repo', url: repo });

  const live =
    raw.live ||
    raw.netlify_live ||
    (Array.isArray(raw.links)
      ? raw.links.find((l) => String(l?.label || '').toLowerCase() === 'live')?.url
      : null);

  const liveUrl = liveUrlFromHost(live);
  if (liveUrl) links.push({ label: 'Live', url: liveUrl });

  return links.length ? links : repo ? [{ label: 'Repo', url: repo }] : [];
}

function normalizeUpdatedAt(value) {
  if (!value || typeof value !== 'string') return '1970-01-01T00:00:00Z';
  let v = value.trim();
  if (!v) return '1970-01-01T00:00:00Z';
  if (!v.includes('T') && (v.includes('+') || v.includes(' '))) {
    v = v.replace(' ', 'T').split('+')[0];
  }
  if (!v.endsWith('Z') && !/[+-]\d{2}:\d{2}$/.test(v)) v += 'Z';
  return v;
}

function parsePriorityScore(value, fallback = 100) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1000, Math.round(n)));
}

/**
 * @param {Record<string, unknown>} raw
 * @param {{ tech?: string[], links?: {label:string,url:string}[], priority_score?: number }} [overlay]
 */
export function normalizeProject(raw, overlay = null) {
  const repo = normRepo(String(raw.repo || '')) || String(raw.repo || '').trim();
  const slug =
    String(raw.slug || '').trim() ||
    (repo ? repo.split('/').pop() : '') ||
    String(raw.title || 'project')
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/[-\s]+/g, '-');

  let tech = overlay?.tech ?? parseTech(raw.tech);
  if (!tech.length && raw.language) tech = parseTech(raw.language);
  if (!tech.length && typeof raw.language === 'string' && raw.language.trim()) {
    tech = [raw.language.trim()];
  }

  const links = overlay?.links?.length ? overlay.links : buildLinks(raw, repo);

  const statusRaw = raw.status || raw.draft_or_published;
  const status =
    statusRaw === 'draft' || statusRaw === 'published'
      ? statusRaw
      : String(raw.is_published || '').toLowerCase() === 'true' || statusRaw === 'published'
        ? 'published'
        : 'draft';

  const out = {
    title: String(raw.title || slug).trim() || slug,
    description: String(raw.description || '').trim(),
    repo,
    updated_at: normalizeUpdatedAt(raw.updated_at),
    slug,
    status,
    private: Boolean(raw.private),
    fav: Boolean(raw.fav),
    priority_score: parsePriorityScore(
      overlay?.priority_score ?? raw.priority_score ?? raw.priority_level,
      100,
    ),
    tech,
    links,
  };

  const thumb = raw.thumbnail;
  if (thumb !== null && thumb !== undefined && String(thumb).trim()) {
    out.thumbnail = String(thumb).trim();
  } else {
    out.thumbnail = '';
  }

  if (tech.length) {
    out.language = tech.join(', ');
  } else if (typeof raw.language === 'string' && raw.language.trim()) {
    out.language = raw.language.trim();
  }

  return stripLegacyProjectKeys(out);
}

/** @param {Record<string, unknown>} data */
export function normalizePersonalProjectsFile(data) {
  const projects = Array.isArray(data?.projects) ? data.projects : [];
  const byRepo = new Map();

  for (const raw of projects) {
    const repo = normRepo(String(raw.repo || ''));
    if (!repo) continue;
    const next = normalizeProject(raw);
    const prev = byRepo.get(repo);
    if (!prev || (next.updated_at || '') >= (prev.updated_at || '')) {
      byRepo.set(repo, next);
    }
  }

  const list = [...byRepo.values()].sort((a, b) => {
    const ps = (b.priority_score || 0) - (a.priority_score || 0);
    if (ps !== 0) return ps;
    return (b.updated_at || '').localeCompare(a.updated_at || '');
  });

  return { projects: list };
}
