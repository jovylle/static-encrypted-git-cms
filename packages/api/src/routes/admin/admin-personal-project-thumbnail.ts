import { Env, jsonResponse, badRequest, serverError } from '../../helpers';
import { readEncryptedJsonFile, writeEncryptedJsonFile } from '../../lib/encrypted-content-store';
import { getGithubConfig, getRepoTextFile, writeRepoBinaryFile } from '../../lib/github-content';
import { readMergeWriteWithRetry } from '../../lib/read-merge-write';
import { PhotonImage, SamplingFilter, crop, resize } from '@cf-wasm/photon/workerd';

const TARGET_WIDTH = 960;
const TARGET_HEIGHT = 540;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const THUMBNAIL_CDN_BASE = 'https://content.jovylle.com/images/personal-projects';
const THUMBNAIL_REPO_DIR = 'public/images/personal-projects';
const COLLECTION_KEY = 'personal-projects';
const PROJECTS_FILE = 'data/encrypted/personal-projects.json.enc';

function isValidSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

async function normalizeImage(bytes: Uint8Array): Promise<Uint8Array> {
  const inputImage = PhotonImage.new_from_byteslice(bytes);

  const srcW = inputImage.get_width();
  const srcH = inputImage.get_height();

  // Center-crop to 16:9 then resize to 960x540.
  const targetAspect = TARGET_WIDTH / TARGET_HEIGHT; // 16/9
  const srcAspect = srcW / srcH;

  let cropX: number, cropY: number, cropW: number, cropH: number;
  if (srcAspect > targetAspect) {
    // Wider than 16:9 — crop the sides
    cropH = srcH;
    cropW = Math.round(srcH * targetAspect);
    cropX = Math.round((srcW - cropW) / 2);
    cropY = 0;
  } else {
    // Taller than 16:9 — crop top/bottom
    cropW = srcW;
    cropH = Math.round(srcW / targetAspect);
    cropX = 0;
    cropY = Math.round((srcH - cropH) / 2);
  }

  const cropped = crop(inputImage, cropX, cropY, cropX + cropW, cropY + cropH);
  inputImage.free();

  const resized = resize(cropped, TARGET_WIDTH, TARGET_HEIGHT, SamplingFilter.Lanczos3);
  cropped.free();

  const outputBytes = resized.get_bytes_webp();
  resized.free();

  return outputBytes;
}

export async function handleAdminPersonalProjectThumbnail(
  env: Env,
  request: Request,
  adminUser: string,
  slug: string,
): Promise<Response> {
  const safeSlug = String(slug || '').trim();

  if (!safeSlug || !isValidSlug(safeSlug)) {
    return badRequest('slug must be lowercase letters, numbers, and hyphens');
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return badRequest('Expected multipart/form-data');
  }

  const fileEntry = formData.get('file');
  if (!fileEntry || typeof fileEntry === 'string') {
    return badRequest('file field is required');
  }
  const uploadedFile = fileEntry as File;

  if (!ALLOWED_MIME_TYPES.has(uploadedFile.type)) {
    return badRequest(
      `File type "${uploadedFile.type}" is not allowed. Accepted: ${[...ALLOWED_MIME_TYPES].join(', ')}`,
    );
  }

  if (uploadedFile.size > MAX_FILE_SIZE) {
    return badRequest('File exceeds 10 MB limit');
  }

  // Process the image
  let processedBytes: Uint8Array;
  try {
    const rawBuffer = await uploadedFile.arrayBuffer();
    processedBytes = await normalizeImage(new Uint8Array(rawBuffer));
  } catch (e: any) {
    return serverError(`Image processing failed: ${e.message}`);
  }

  // Commit the image to git
  const config = getGithubConfig(env);
  const filePath = `${THUMBNAIL_REPO_DIR}/${safeSlug}.webp`;
  const thumbnailUrl = `${THUMBNAIL_CDN_BASE}/${safeSlug}.webp`;

  let imageWrite: unknown;
  try {
    const existing = await getRepoTextFile(config, filePath);
    imageWrite = await writeRepoBinaryFile(config, {
      filePath,
      bytes: processedBytes,
      message: `admin: update thumbnail for ${safeSlug}`,
      actor: adminUser,
      branchHint: `thumbnail-${safeSlug}`,
      previousSha: existing.sha || undefined,
    });
  } catch (e: any) {
    return serverError(`Image commit failed: ${e.message}`);
  }

  // Patch the project's thumbnail field in the encrypted JSON
  let jsonWrite: unknown;
  try {
    const result = await readMergeWriteWithRetry<any, unknown>({
      collectionKey: COLLECTION_KEY,
      filePath: PROJECTS_FILE,
      defaultValue: null,
      mergeFn: (doc) => {
        if (!doc || typeof doc !== 'object' || !Array.isArray((doc as any).projects)) {
          throw new Error('personal-projects collection not found or malformed');
        }
        const projects: any[] = (doc as any).projects;
        const idx = projects.findIndex((p: any) => p?.slug === safeSlug);
        if (idx === -1) {
          const err: any = new Error(`Project with slug "${safeSlug}" not found`);
          err.status = 404;
          throw err;
        }
        const updated = [...projects];
        updated[idx] = { ...updated[idx], thumbnail: thumbnailUrl };
        return { ...(doc as any), projects: updated };
      },
      actor: adminUser,
      branchHint: `thumbnail-${safeSlug}`,
      message: `admin: update thumbnail for ${safeSlug}`,
      writeMode: env.ADMIN_GITHUB_WRITE_MODE,
      readFile: (fp, dv) => readEncryptedJsonFile(env, fp, dv),
      writeFile: (args) =>
        writeEncryptedJsonFile(env, {
          filePath: args.filePath,
          data: args.data,
          sha: args.sha,
          actor: args.actor || adminUser,
          branchHint: args.branchHint || `thumbnail-${safeSlug}`,
          message: args.message || `admin: update thumbnail for ${safeSlug}`,
        }),
    });
    jsonWrite = result.write;
  } catch (e: any) {
    if (e?.status === 404) {
      return jsonResponse({ error: e.message }, 404);
    }
    if (e?.name === 'ValidationError') {
      return jsonResponse({ error: 'Validation failed', validationErrors: e.validationErrors }, 400);
    }
    return serverError(e.message);
  }

  return jsonResponse({ ok: true, slug: safeSlug, thumbnail: thumbnailUrl, imageWrite, jsonWrite });
}
