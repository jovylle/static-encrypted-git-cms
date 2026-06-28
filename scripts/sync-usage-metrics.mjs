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

function rowToStats(row) {
  const visits = row.sum?.visits ?? 0;
  const requests = row.count ?? 0;
  return {
    unique_visitors_30d: 0,
    daily_avg: 0,
    visits_30d: visits,
    visits_daily_avg: 0,
    pageviews_30d: visits,
    requests_30d: requests,
  };
}

function* iterateDays(windowDays, endInclusive) {
  const end = new Date(`${endInclusive}T00:00:00Z`);
  for (let offset = windowDays - 1; offset >= 0; offset -= 1) {
    const dayStart = new Date(end);
    dayStart.setUTCDate(dayStart.getUTCDate() - offset);
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
    yield {
      startDate: isoDateOnly(dayStart),
      endDateExclusive: isoDateOnly(dayEnd),
    };
  }
}

function buildCandidateHostnames(config, zones) {
  const set = new Set();
  for (const group of config.site_groups ?? []) {
    for (const host of group.hostnames ?? []) set.add(host.toLowerCase());
  }
  for (const host of Object.keys(config.hostname_overrides ?? {})) {
    set.add(host.toLowerCase());
  }
  for (const zone of zones) {
    set.add(zone.name.toLowerCase());
    set.add(`www.${zone.name.toLowerCase()}`);
  }
  return [...set];
}

function resolveZoneForHostname(hostname, zones, hostZoneMap) {
  const host = hostname.toLowerCase();
  if (hostZoneMap.has(host)) return hostZoneMap.get(host);

  const parts = host.split('.');
  for (let i = 0; i < parts.length - 1; i += 1) {
    const suffix = parts.slice(i).join('.');
    const zone = zones.find((z) => z.name.toLowerCase() === suffix);
    if (zone) return zone;
  }
  return null;
}

async function graphqlQuery(token, query, variables) {
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
    throw new Error(msg);
  }
  return body.data;
}

function sumGroupRows(rows, pickVisits) {
  return rows.reduce(
    (acc, row) => {
      const visits = pickVisits(row);
      acc.visits += visits;
      acc.requests += row.sum?.requests ?? row.count ?? 0;
      return acc;
    },
    { visits: 0, requests: 0 },
  );
}

async function fetchZoneVisits1dGroups({ token, zoneId, startDate, endDate }) {
  const query = `
    query ZoneDailyVisits($zoneTag: string, $filter: ZoneHttpRequests1dGroupsFilter!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          days: httpRequests1dGroups(
            limit: 31
            orderBy: [date_ASC]
            filter: $filter
          ) {
            sum { visits pageViews requests }
            dimensions { date }
          }
        }
      }
    }
  `;

  const data = await graphqlQuery(token, query, {
    zoneTag: zoneId,
    filter: { date_geq: startDate, date_leq: endDate },
  });

  const rows = data?.viewer?.zones?.[0]?.days ?? [];
  return sumGroupRows(rows, (row) => row.sum?.visits ?? row.sum?.pageViews ?? 0);
}

async function fetchHostnameVisitsForDay({ token, zoneId, hostname, startDate, endDateExclusive }) {
  const query = `
    query HostDayVisits($zoneTag: string, $filter: ZoneHttpRequestsAdaptiveGroupsFilter!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          traffic: httpRequestsAdaptiveGroups(limit: 1, filter: $filter) {
            count
            sum { visits pageViews }
          }
        }
      }
    }
  `;

  const data = await graphqlQuery(token, query, {
    zoneTag: zoneId,
    filter: {
      AND: [
        {
          datetime_geq: `${startDate}T00:00:00Z`,
          datetime_lt: `${endDateExclusive}T00:00:00Z`,
        },
        { requestSource: 'eyeball' },
        { clientRequestHTTPHost: hostname },
      ],
    },
  });

  const rows = data?.viewer?.zones?.[0]?.traffic ?? [];
  return sumGroupRows(rows, (row) => row.sum?.visits ?? row.sum?.pageViews ?? 0);
}

async function fetchZoneHostnamesGrouped({ token, zoneId, startDate, endDateExclusive, limit }) {
  const query = `
    query ZoneHostnameTraffic($zoneTag: string, $filter: ZoneHttpRequestsAdaptiveGroupsFilter!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          byHost: httpRequestsAdaptiveGroups(
            limit: ${limit}
            orderBy: [sum_visits_DESC]
            filter: $filter
          ) {
            count
            dimensions { clientRequestHTTPHost }
            sum { visits pageViews }
          }
        }
      }
    }
  `;

  const data = await graphqlQuery(token, query, {
    zoneTag: zoneId,
    filter: {
      AND: [
        {
          datetime_geq: `${startDate}T00:00:00Z`,
          datetime_lt: `${endDateExclusive}T00:00:00Z`,
        },
        { requestSource: 'eyeball' },
      ],
    },
  });

  return data?.viewer?.zones?.[0]?.byHost ?? [];
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

async function collectRecentHostnameVisits({
  token,
  zone,
  config,
  recentDays,
  endDate,
  maxPerZone,
  hostRecentVisits,
  hostZoneMap,
}) {
  let rowCount = 0;

  for (const day of iterateDays(recentDays, endDate)) {
    const rows = await fetchZoneHostnamesGrouped({
      token,
      zoneId: zone.id,
      startDate: day.startDate,
      endDateExclusive: day.endDateExclusive,
      limit: maxPerZone,
    });
    rowCount += rows.length;

    for (const row of rows) {
      const host = row.dimensions?.clientRequestHTTPHost?.toLowerCase();
      if (!host || isExcluded(host, config)) continue;

      const delta = rowToStats(row);
      hostZoneMap.set(host, zone);
      hostRecentVisits.set(host, (hostRecentVisits.get(host) ?? 0) + delta.visits_30d);
    }
  }

  return rowCount;
}

async function estimateHostnameVisits30d({
  token,
  zones,
  config,
  candidates,
  hostRecentVisits,
  hostZoneMap,
  windowDays,
  recentDays,
  startDate,
  endDate,
}) {
  const zoneRecentTotals = new Map();
  const zone30dTotals = new Map();

  for (const zone of zones) {
    try {
      zone30dTotals.set(zone.id, await fetchZoneVisits1dGroups({
        token,
        zoneId: zone.id,
        startDate,
        endDate,
      }));
    } catch (err) {
      console.warn(`[usage-metrics] Skip zone 30d rollup ${zone.name}: ${err.message}`);
      zone30dTotals.set(zone.id, { visits: 0, requests: 0 });
    }
  }

  for (const [host, recentVisits] of hostRecentVisits) {
    const zone = hostZoneMap.get(host) ?? resolveZoneForHostname(host, zones, hostZoneMap);
    if (!zone) continue;
    zoneRecentTotals.set(zone.id, (zoneRecentTotals.get(zone.id) ?? 0) + recentVisits);
  }

  const hostnameStats = new Map();

  for (const rawHost of candidates) {
    const host = rawHost.toLowerCase();
    if (isExcluded(host, config)) continue;

    const zone = resolveZoneForHostname(host, zones, hostZoneMap);
    if (!zone) continue;

    let recentVisits = hostRecentVisits.get(host) ?? 0;
    if (recentVisits === 0) {
      try {
        for (const day of iterateDays(recentDays, endDate)) {
          const dayTotal = await fetchHostnameVisitsForDay({
            token,
            zoneId: zone.id,
            hostname: host,
            startDate: day.startDate,
            endDateExclusive: day.endDateExclusive,
          });
          recentVisits += dayTotal.visits;
        }
      } catch (err) {
        console.warn(`[usage-metrics] Skip recent slice for ${host}: ${err.message}`);
      }
    }

    const zoneRecent = zoneRecentTotals.get(zone.id) ?? 0;
    const zone30d = zone30dTotals.get(zone.id)?.visits ?? 0;
    let visits30d = 0;

    if (recentVisits > 0 && zoneRecent > 0) {
      visits30d = Math.round(zone30d * (recentVisits / zoneRecent));
    } else if (recentVisits > 0 && zone30d === 0) {
      visits30d = recentVisits;
    } else if (host === zone.name.toLowerCase() || host === `www.${zone.name.toLowerCase()}`) {
      visits30d = zone30d;
    }

    if (visits30d <= 0) continue;

    hostnameStats.set(host, {
      unique_visitors_30d: 0,
      daily_avg: 0,
      visits_30d: visits30d,
      visits_daily_avg: Math.round(visits30d / windowDays),
      pageviews_30d: visits30d,
      requests_30d: 0,
      zone: zone.name,
      recent_visits: recentVisits,
    });
  }

  return hostnameStats;
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
  const recentDays = config.adaptive_recent_days ?? 7;
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
    discovery: 'zone_30d_with_recent_hostname_share',
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
  const hostRecentVisits = new Map();
  const hostZoneMap = new Map();
  const candidates = buildCandidateHostnames(config, zones);

  console.log(`[usage-metrics] Scanning ${zones.length} Cloudflare zone(s)…`);

  for (const zone of zones) {
    payload.zones_scanned.push({ id: zone.id, name: zone.name });

    try {
      const rowCount = await collectRecentHostnameVisits({
        token,
        zone,
        config,
        recentDays,
        endDate,
        maxPerZone,
        hostRecentVisits,
        hostZoneMap,
      });
      console.log(
        `[usage-metrics] Zone ${zone.name}: ${rowCount} hostname row(s) in last ${recentDays} day(s)`,
      );
    } catch (err) {
      console.warn(`[usage-metrics] Skip recent discovery ${zone.name}: ${err.message}`);
    }
  }

  const hostnameStats = await estimateHostnameVisits30d({
    token,
    zones,
    config,
    candidates,
    hostRecentVisits,
    hostZoneMap,
    windowDays,
    recentDays,
    startDate,
    endDate,
  });

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
