#!/usr/bin/env node
/**
 * Pull Cloudflare zone analytics → public/data/usage-metrics.json
 *
 * - site_groups: multiple DNS aliases → one portfolio entry (visits summed)
 * - other hostnames: one entry each if above threshold
 *
 * Required env: CLOUDFLARE_API_TOKEN
 * Optional: CLOUDFLARE_ACCOUNT_ID
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadDotEnv } from './lib/data-io.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(__dirname, 'usage-metrics.config.json');
const OUT_PATH = path.join(ROOT, 'public', 'data', 'usage-metrics.json');

const REST_BASE = 'https://api.cloudflare.com/client/v4';
const GRAPHQL_URL = `${REST_BASE}/graphql`;

loadDotEnv();

function readConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function isoDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function hostnameId(value) {
  return String(value)
    .replace(/\./g, '-')
    .replace(/[^a-z0-9-]/gi, '')
    .toLowerCase();
}

function isExcluded(hostname, config) {
  const host = hostname.toLowerCase();
  if ((config.exclude_hostnames ?? []).includes(host)) return true;
  for (const pattern of config.exclude_hostname_patterns ?? []) {
    if (new RegExp(pattern, 'i').test(host)) return true;
  }
  return false;
}

function groupedHostnameSet(config) {
  const set = new Set();
  for (const group of config.site_groups ?? []) {
    for (const host of group.hostnames ?? []) {
      set.add(host.toLowerCase());
    }
  }
  return set;
}

function rowToStats(row, windowDays) {
  const unique = row.uniq?.uniques ?? 0;
  const visits = row.sum?.visits ?? 0;
  return {
    unique_visitors_30d: unique,
    daily_avg: unique > 0 ? Math.round(unique / windowDays) : 0,
    visits_30d: visits,
    visits_daily_avg: visits > 0 ? Math.round(visits / windowDays) : 0,
    pageviews_30d: row.sum?.pageViews ?? 0,
    requests_30d: row.sum?.requests ?? 0,
  };
}

function passesIndividualThreshold(stats, host, config) {
  const defaults = config.defaults ?? {};
  const override = config.hostname_overrides?.[host] ?? {};
  const minDaily = override.min_daily_avg ?? defaults.min_daily_avg ?? 5;
  const minVisits = override.min_visits_30d ?? defaults.min_visits_30d ?? 75;
  return stats.visits_30d >= minVisits && stats.visits_daily_avg >= minDaily;
}

function passesGroupThreshold(stats, group, defaults) {
  const minVisits = group.min_visits_30d ?? defaults.min_visits_30d ?? 150;
  const minDaily =
    group.min_visits_daily_avg ?? group.min_daily_avg ?? defaults.min_daily_avg ?? 5;
  return stats.visits_30d >= minVisits && stats.visits_daily_avg >= minDaily;
}

async function cfRest(token, pathname, searchParams = {}) {
  const url = new URL(`${REST_BASE}${pathname}`);
  for (const [key, value] of Object.entries(searchParams)) {
    if (value != null && value !== '') url.searchParams.set(key, String(value));
  }
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const body = await res.json();
  if (!res.ok || !body.success) {
    throw new Error(body.errors?.map((e) => e.message).join('; ') || res.statusText);
  }
  return body.result;
}

async function listAllZones(token, accountId) {
  const zones = [];
  let page = 1;
  while (true) {
    const params = { page, per_page: 50, status: 'active' };
    if (accountId) params['account.id'] = accountId;
    const batch = await cfRest(token, '/zones', params);
    if (!Array.isArray(batch)) break;
    zones.push(...batch);
    if (batch.length < 50) break;
    page += 1;
  }
  return zones;
}

async function fetchZoneHostnames({ token, zoneId, startDate, endDate, limit }) {
  const query = `
    query ZoneHostnameTraffic($zoneTag: string, $filter: ZoneHttpRequestsAdaptiveGroupsFilter!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          byHost: httpRequestsAdaptiveGroups(
            limit: ${limit}
            orderBy: [sum_visits_DESC]
            filter: $filter
          ) {
            dimensions { clientRequestHTTPHost }
            sum { pageViews requests visits }
          }
        }
      }
    }
  `;

  const variables = {
    zoneTag: zoneId,
    filter: {
      AND: [
        { datetime_geq: `${startDate}T00:00:00Z`, datetime_lt: `${endDate}T23:59:59Z` },
        { requestSource: 'eyeball' },
      ],
    },
  };

  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  const body = await res.json();
  if (!res.ok || body.errors?.length) {
    const msg = body.errors?.map((e) => e.message).join('; ') || res.statusText;
    throw new Error(`GraphQL zone ${zoneId}: ${msg}`);
  }

  return body.data?.viewer?.zones?.[0]?.byHost ?? [];
}

function aggregateGroup(group, hostnameStats, windowDays, defaults) {
  const breakdown = [];
  let visits_30d = 0;
  let unique_visitors_30d = 0;
  let pageviews_30d = 0;
  let requests_30d = 0;
  const zones = new Set();

  for (const rawHost of group.hostnames ?? []) {
    const host = rawHost.toLowerCase();
    const stat = hostnameStats.get(host);
    if (!stat) continue;
    breakdown.push({
      hostname: host,
      visits_30d: stat.visits_30d,
      unique_visitors_30d: stat.unique_visitors_30d,
    });
    visits_30d += stat.visits_30d;
    unique_visitors_30d += stat.unique_visitors_30d;
    pageviews_30d += stat.pageviews_30d;
    requests_30d += stat.requests_30d;
    if (stat.zone) zones.add(stat.zone);
  }

  if (!breakdown.length) return null;

  const stats = {
    visits_30d,
    visits_daily_avg: Math.round(visits_30d / windowDays),
    unique_visitors_30d,
    daily_avg: Math.round(unique_visitors_30d / windowDays),
    pageviews_30d,
    requests_30d,
  };

  if (!passesGroupThreshold(stats, group, defaults)) return null;

  return {
    id: group.id || hostnameId(group.label),
    label: group.label,
    url: group.url,
    note: group.note ?? null,
    grouped: true,
    hostnames: breakdown.map((b) => b.hostname),
    hostname_breakdown: breakdown,
    zones: [...zones],
    ...stats,
    match: group.match ?? { domains: group.hostnames ?? [] },
  };
}

async function main() {
  const config = readConfig();
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() || null;
  const windowDays = config.window_days ?? 30;
  const maxPerZone = config.max_hostnames_per_zone ?? 40;
  const defaults = config.defaults ?? {};
  const inGroup = groupedHostnameSet(config);

  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - windowDays);
  const startDate = isoDateOnly(start);
  const endDate = isoDateOnly(end);

  const payload = {
    updated_at: new Date().toISOString(),
    window_days: windowDays,
    window_start: startDate,
    window_end: endDate,
    source: 'cloudflare_zone_analytics',
    discovery: 'groups_plus_hostnames',
    defaults,
    zones_scanned: [],
    sites: [],
  };

  if (!token) {
    console.warn('[usage-metrics] CLOUDFLARE_API_TOKEN not set — writing empty sites list.');
    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(OUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  const zones = await listAllZones(token, accountId);
  const hostnameStats = new Map();

  console.log(`[usage-metrics] Scanning ${zones.length} Cloudflare zone(s)…`);

  for (const zone of zones) {
    payload.zones_scanned.push({ id: zone.id, name: zone.name });

    let rows;
    try {
      rows = await fetchZoneHostnames({
        token,
        zoneId: zone.id,
        startDate,
        endDate,
        limit: maxPerZone,
      });
    } catch (err) {
      console.warn(`[usage-metrics] Skip zone ${zone.name}: ${err.message}`);
      continue;
    }

    console.log(`[usage-metrics] Zone ${zone.name}: ${rows.length} hostname row(s) from API`);

    for (const row of rows) {
      const host = row.dimensions?.clientRequestHTTPHost?.toLowerCase();
      if (!host || isExcluded(host, config)) continue;

      const stats = rowToStats(row, windowDays);
      const existing = hostnameStats.get(host);
      if (existing && existing.visits_30d >= stats.visits_30d) continue;

      hostnameStats.set(host, { ...stats, zone: zone.name });
    }
  }

  const sites = [];

  for (const group of config.site_groups ?? []) {
    const entry = aggregateGroup(group, hostnameStats, windowDays, defaults);
    if (!entry) {
      console.log(`[usage-metrics] Hide group ${group.id}: below threshold or no data`);
      continue;
    }
    sites.push(entry);
    console.log(
      `[usage-metrics] Group ${group.label}: ~${entry.visits_daily_avg} visits/day (${entry.visits_30d} total across ${entry.hostnames.length} hostname(s))`,
    );
  }

  for (const [host, stat] of hostnameStats) {
    if (inGroup.has(host)) continue;

    if (!passesIndividualThreshold(stat, host, config)) {
      console.log(
        `[usage-metrics] Hide ${host}: ${stat.visits_daily_avg} visits/day — below threshold`,
      );
      continue;
    }

    const override = config.hostname_overrides?.[host] ?? {};
    sites.push({
      id: hostnameId(host),
      label: override.label || host,
      url: `https://${host}`,
      grouped: false,
      hostnames: [host],
      zone: stat.zone,
      ...stat,
      match: override.match ?? { domains: [host] },
    });
    console.log(
      `[usage-metrics] Include ${host}: ~${stat.visits_daily_avg} visits/day`,
    );
  }

  payload.sites = sites.sort((a, b) => b.visits_daily_avg - a.visits_daily_avg);

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`[usage-metrics] Wrote ${payload.sites.length} site(s) → ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
