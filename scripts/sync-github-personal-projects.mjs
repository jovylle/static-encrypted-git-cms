#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { decryptJson, encryptJson } from './lib/content-crypto.mjs';
import { SOURCE_DIR, ENCRYPTED_DIR, ROOT } from './lib/data-paths.mjs';

const GITHUB_API_BASE = process.env.GITHUB_API_BASE || 'https://api.github.com';
const GITHUB_USERNAME = process.env.GITHUB_USERNAME || '';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const MIN_DESCRIPTION_LENGTH = Number(process.env.MIN_DESCRIPTION_LENGTH || 24);
const SOURCE_PROJECTS_PATH =
  process.env.PERSONAL_PROJECTS_PATH ||
  path.join(SOURCE_DIR, 'personal-projects.json');
const ENCRYPTED_PROJECTS_PATH = path.join(
  ENCRYPTED_DIR,
  'personal-projects.json.enc',
);
const PERSONAL_PROJECTS_SCHEMA_PATH = path.join(
  ROOT,
  'schemas',
  'personal-projects.schema.json',
);
const DRY_RUN = String(process.env.DRY_RUN || '').toLowerCase() === 'true';

function normalizeRepoUrl(url) {
  if (!url || typeof url !== 'string') return null;
  let value = url.trim();
  if (!value) return null;
  if (!value.startsWith('http')) {
    value = `https://${value.replace(/^\/+/, '')}`;
  }
  if (!value.includes('github.com/')) return null;
  const parts = value.replace(/\/$/, '').toLowerCase().split('/');
  if (parts.length < 5) return null;
  return `https://github.com/${parts[3]}/${parts[4]}`;
}

function uniqueStrings(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    if (!value || typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function cleanupText(value) {
  if (!value || typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim();
}

function markdownToSummary(markdown) {
  if (!markdown || typeof markdown !== 'string') return '';
  const noCodeBlocks = markdown.replace(/```[\s\S]*?```/g, ' ');
  const paragraphs = noCodeBlocks
    .split(/\n\s*\n/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  for (const raw of paragraphs) {
    if (
      raw.startsWith('#') ||
      raw.startsWith('![') ||
      raw.startsWith('<!--') ||
      raw.startsWith('<img')
    ) {
      continue;
    }
    const cleaned = cleanupText(
      raw
        .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/[*_~]+/g, '')
        .replace(/^[-*+]\s+/gm, '')
        .replace(/^>\s+/gm, ''),
    );
    if (cleaned.length >= 12) {
      return cleaned.slice(0, 280);
    }
  }

  return '';
}

async function githubRequest(url, { accept = 'application/vnd.github+json' } = {}) {
  const headers = {
    Accept: accept,
    'User-Agent': 'static-encrypted-cms-sync',
  };
  if (GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub request failed (${response.status}): ${url}\n${text.slice(0, 300)}`);
  }

  return response;
}

async function fetchUserRepos(owner) {
  const repos = [];
  const perPage = 100;
  for (let page = 1; page <= 10; page += 1) {
    const url = `${GITHUB_API_BASE}/users/${owner}/repos?type=owner&sort=created&direction=desc&per_page=${perPage}&page=${page}`;
    const response = await githubRequest(url);
    const chunk = await response.json();
    if (!Array.isArray(chunk) || chunk.length === 0) break;
    repos.push(...chunk);
    if (chunk.length < perPage) break;
  }
  return repos;
}

async function fetchReadmeSummary(owner, repoName) {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repoName}/readme`;
  try {
    const response = await githubRequest(url, { accept: 'application/vnd.github.raw+json' });
    const markdown = await response.text();
    return markdownToSummary(markdown);
  } catch (error) {
    return '';
  }
}

function inferOwnerFromProjects(projects) {
  for (const project of projects) {
    const repo = normalizeRepoUrl(project?.repo);
    if (!repo) continue;
    const parts = repo.split('/');
    if (parts.length >= 5) return parts[3];
  }
  return '';
}

function buildProjectFromRepo(repo, readmeSummary, minDescriptionLength) {
  const normalizedRepo = normalizeRepoUrl(repo.html_url);
  if (!normalizedRepo) return null;

  const fromRepo = cleanupText(repo.description || '');
  const fromReadme = cleanupText(readmeSummary || '');
  const description = fromRepo.length >= minDescriptionLength ? fromRepo : fromReadme;

  if (description.length < minDescriptionLength) {
    return {
      skipped: true,
      reason: `description too short (<${minDescriptionLength})`,
      repo: normalizedRepo,
    };
  }

  const tech = uniqueStrings([repo.language, ...(Array.isArray(repo.topics) ? repo.topics : [])]);

  const links = [{ label: 'Repo', url: normalizedRepo }];
  if (repo.homepage && /^https?:\/\//i.test(repo.homepage)) {
    links.push({ label: 'Live', url: repo.homepage });
  }

  return {
    project: {
      title: repo.name,
      description,
      repo: normalizedRepo,
      updated_at: repo.pushed_at || repo.updated_at || repo.created_at || new Date().toISOString(),
      slug: repo.name,
      status: 'published',
      private: false,
      fav: false,
      priority_score: 100,
      tech,
      links,
      thumbnail: '',
      ...(tech.length ? { language: tech.join(', ') } : {}),
    },
  };
}

async function main() {
  const hasSource = fs.existsSync(SOURCE_PROJECTS_PATH);
  const hasEncrypted = fs.existsSync(ENCRYPTED_PROJECTS_PATH);
  if (!hasSource && !hasEncrypted) {
    throw new Error(
      `Missing personal projects data. Checked ${SOURCE_PROJECTS_PATH} and ${ENCRYPTED_PROJECTS_PATH}`,
    );
  }

  let raw;
  if (hasSource) {
    raw = JSON.parse(fs.readFileSync(SOURCE_PROJECTS_PATH, 'utf8'));
  } else {
    const wrapperText = fs.readFileSync(ENCRYPTED_PROJECTS_PATH, 'utf8');
    raw = JSON.parse(decryptJson(wrapperText));
  }

  const projects = Array.isArray(raw.projects) ? raw.projects : [];
  const owner = GITHUB_USERNAME || inferOwnerFromProjects(projects);
  if (!owner) {
    throw new Error('Could not determine GitHub username. Set GITHUB_USERNAME.');
  }

  const existingRepos = new Set(
    projects
      .map((project) => normalizeRepoUrl(project?.repo))
      .filter(Boolean),
  );

  const repos = await fetchUserRepos(owner);
  const candidates = repos.filter((repo) => repo && !repo.private && !repo.fork);

  let added = 0;
  let skipped = 0;
  const skippedRepos = [];

  for (const repo of candidates) {
    const normalizedRepo = normalizeRepoUrl(repo.html_url);
    if (!normalizedRepo || existingRepos.has(normalizedRepo)) {
      continue;
    }

    const readmeSummary = await fetchReadmeSummary(owner, repo.name);
    const result = buildProjectFromRepo(repo, readmeSummary, MIN_DESCRIPTION_LENGTH);
    if (!result || result.skipped) {
      skipped += 1;
      skippedRepos.push({
        repo: normalizedRepo,
        reason: result?.reason || 'cannot build project payload',
      });
      continue;
    }

    raw.projects.push(result.project);
    existingRepos.add(normalizedRepo);
    added += 1;
  }

  if (added > 0 && !DRY_RUN) {
    const schema = JSON.parse(
      fs.readFileSync(PERSONAL_PROJECTS_SCHEMA_PATH, 'utf8'),
    );
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const valid = validate(raw);
    if (!valid) {
      const details = (validate.errors || [])
        .map((error) => `${error.instancePath || '/'} ${error.message}`)
        .join('; ');
      throw new Error(`Schema validation failed after sync: ${details}`);
    }

    if (hasSource) {
      fs.writeFileSync(
        SOURCE_PROJECTS_PATH,
        `${JSON.stringify(raw, null, 2)}\n`,
        'utf8',
      );
    }

    if (hasEncrypted) {
      if (process.env.CONTENT_DECRYPT_KEY) {
        const wrapper = encryptJson(JSON.stringify(raw, null, 2));
        fs.writeFileSync(ENCRYPTED_PROJECTS_PATH, `${wrapper}\n`, 'utf8');
      } else {
        console.warn(
          'CONTENT_DECRYPT_KEY not set: skipped encrypted file update.',
        );
      }
    }
  }

  console.log(`Workspace: ${ROOT}`);
  console.log(`Source file: ${SOURCE_PROJECTS_PATH} (${hasSource ? 'found' : 'missing'})`);
  console.log(
    `Encrypted file: ${ENCRYPTED_PROJECTS_PATH} (${hasEncrypted ? 'found' : 'missing'})`,
  );
  console.log(`GitHub owner: ${owner}`);
  console.log(`Scanned public repos: ${candidates.length}`);
  console.log(`Added new projects: ${added}${DRY_RUN ? ' (dry run)' : ''}`);
  console.log(`Skipped (insufficient metadata): ${skipped}`);
  if (skippedRepos.length) {
    console.log('Skipped repo details:');
    for (const item of skippedRepos) {
      console.log(`- ${item.repo} -> ${item.reason}`);
    }
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
