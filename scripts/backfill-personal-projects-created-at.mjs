#!/usr/bin/env node
/**
 * Backfill missing created_at on personal projects from the GitHub API.
 *
 *   npm run data:decrypt
 *   npm run data:backfill-personal-projects-created-at
 *   npm run data:save
 */

import fs from 'fs';
import path from 'path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { decryptJson, encryptJson } from './lib/content-crypto.mjs';
import { SOURCE_DIR, ENCRYPTED_DIR, ROOT } from './lib/data-paths.mjs';
import { loadDotEnv } from './lib/data-io.mjs';
import { fetchRepoCreatedAt } from './lib/github-repo-meta.mjs';
import { normalizeProject, normRepo } from './lib/personal-project-normalize.mjs';

loadDotEnv();

const GITHUB_API_BASE = process.env.GITHUB_API_BASE || 'https://api.github.com';
const GITHUB_USERNAME = process.env.GITHUB_USERNAME || 'jovylle';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

const SOURCE_PATH = path.join(SOURCE_DIR, 'personal-projects.json');
const ENCRYPTED_PATH = path.join(ENCRYPTED_DIR, 'personal-projects.json.enc');
const SCHEMA_PATH = path.join(ROOT, 'schemas', 'personal-projects.schema.json');
const DRY_RUN = String(process.env.DRY_RUN || '').toLowerCase() === 'true';

function githubHeaders() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'static-encrypted-cms-backfill',
  };
  if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  return headers;
}

async function fetchUserRepos(owner) {
  const repos = [];
  const perPage = 100;
  for (let page = 1; page <= 20; page += 1) {
    const url = `${GITHUB_API_BASE}/users/${owner}/repos?type=owner&sort=created&direction=desc&per_page=${perPage}&page=${page}`;
    const response = await fetch(url, { headers: githubHeaders() });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitHub request failed (${response.status}): ${text.slice(0, 300)}`);
    }
    const chunk = await response.json();
    if (!Array.isArray(chunk) || chunk.length === 0) break;
    repos.push(...chunk);
    if (chunk.length < perPage) break;
  }
  return repos;
}

function inferOwnerFromProjects(projects) {
  for (const project of projects) {
    const repo = normRepo(String(project?.repo || ''));
    if (!repo) continue;
    const parts = repo.split('/');
    if (parts.length >= 5) return parts[3];
  }
  return '';
}

async function buildCreatedAtIndex(projects) {
  const owner = GITHUB_USERNAME || inferOwnerFromProjects(projects);
  if (!owner) {
    throw new Error('Could not determine GitHub username. Set GITHUB_USERNAME.');
  }

  const repos = await fetchUserRepos(owner);
  const index = new Map();
  for (const repo of repos) {
    const normalized = normRepo(repo.html_url);
    if (normalized && repo.created_at) {
      index.set(normalized, repo.created_at);
    }
  }
  return index;
}

function loadProjectsFile() {
  const hasSource = fs.existsSync(SOURCE_PATH);
  const hasEncrypted = fs.existsSync(ENCRYPTED_PATH);
  if (!hasSource && !hasEncrypted) {
    throw new Error(`Missing personal projects data at ${SOURCE_PATH} or ${ENCRYPTED_PATH}`);
  }

  if (hasSource) {
    return {
      raw: JSON.parse(fs.readFileSync(SOURCE_PATH, 'utf8')),
      hasSource,
      hasEncrypted,
    };
  }

  const wrapperText = fs.readFileSync(ENCRYPTED_PATH, 'utf8');
  return {
    raw: JSON.parse(decryptJson(wrapperText)),
    hasSource: false,
    hasEncrypted,
  };
}

async function main() {
  const { raw, hasSource, hasEncrypted } = loadProjectsFile();
  const projects = Array.isArray(raw.projects) ? raw.projects : [];
  const createdAtIndex = await buildCreatedAtIndex(projects);
  let filled = 0;
  let alreadyHad = 0;
  let missingRepo = 0;
  let notFound = 0;

  for (const project of projects) {
    if (project?.created_at) {
      alreadyHad += 1;
      continue;
    }

    const repoUrl = normRepo(String(project?.repo || ''));
    if (!repoUrl) {
      missingRepo += 1;
      continue;
    }

    const createdAt = createdAtIndex.get(repoUrl);
    if (!createdAt) {
      const fallback = await fetchRepoCreatedAt(repoUrl).catch(() => null);
      if (!fallback) {
        notFound += 1;
        continue;
      }
      project.created_at = fallback;
      filled += 1;
      continue;
    }

    project.created_at = createdAt;
    filled += 1;
  }

  raw.projects = projects.map((project) => normalizeProject(project));

  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (!validate(raw)) {
    const details = (validate.errors || [])
      .map((error) => `${error.instancePath || '/'} ${error.message}`)
      .join('; ');
    throw new Error(`Schema validation failed after backfill: ${details}`);
  }

  if (!DRY_RUN) {
    if (hasSource) {
      fs.writeFileSync(SOURCE_PATH, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
    }
    if (hasEncrypted && process.env.CONTENT_DECRYPT_KEY) {
      const wrapper = encryptJson(JSON.stringify(raw, null, 2));
      fs.writeFileSync(ENCRYPTED_PATH, `${wrapper}\n`, 'utf8');
    } else if (hasEncrypted) {
      console.warn('CONTENT_DECRYPT_KEY not set: skipped encrypted file update.');
    }
  }

  console.log(`Projects total: ${projects.length}`);
  console.log(`Already had created_at: ${alreadyHad}`);
  console.log(`Backfilled created_at: ${filled}${DRY_RUN ? ' (dry run)' : ''}`);
  console.log(`Missing repo URL: ${missingRepo}`);
  console.log(`Repo not found on GitHub: ${notFound}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
