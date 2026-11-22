// Gate checks shared by data-export.mjs and data-export-dry-run.mjs (and tests/export-fail-closed.test.mjs).
//
// loadPublishControls({ encryptedDir }) -> { controls, failure }
//   controls: normalized publish controls when the file is valid, otherwise null.
//   failure:  null when valid. Otherwise { file, message }. A missing, 0-byte, undecryptable, unparseable, non-object
//             or schema-invalid publish-controls.json.enc is ALWAYS a failure. It is never treated as "all public".
//             The schema is strict: all 10 collection ids, each 'public'|'draft'|'private'.
//   Callers must treat a failure as "nothing collection-gated may be exported" (see export-public.mjs).
//   fast-scores.json is NOT gated: it has no controls entry and is always public (ALWAYS_PUBLIC_ROOT_FILES).
//
// checkContentKey() -> null when CONTENT_DECRYPT_KEY is usable, otherwise one message string.

import fs from 'fs';
import path from 'path';
import { getContentKey, decryptJson } from './content-crypto.mjs';
import { ENCRYPTED_DIR } from './data-paths.mjs';
import { normalizePublishControls, validatePublishControlsShape } from './publish-controls.mjs';

export const PUBLISH_CONTROLS_FILE = 'publish-controls.json.enc';

export function checkContentKey() {
  try {
    getContentKey();
    return null;
  } catch (e) {
    return `${e.message} Nothing was exported.`;
  }
}

export function loadPublishControls({ encryptedDir = ENCRYPTED_DIR } = {}) {
  const fullEnc = path.join(encryptedDir, PUBLISH_CONTROLS_FILE);
  const fail = (message) => ({
    controls: null,
    failure: { file: PUBLISH_CONTROLS_FILE, message },
  });

  if (!fs.existsSync(fullEnc)) {
    return fail('missing encrypted file. Publish controls are required; every collection is gated on them.');
  }
  if (fs.statSync(fullEnc).size === 0) {
    return fail('empty encrypted file. Publish controls are required; every collection is gated on them.');
  }

  let data;
  try {
    data = JSON.parse(decryptJson(fs.readFileSync(fullEnc, 'utf8')));
  } catch (e) {
    return fail(`decrypt or parse failed: ${e.message}`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return fail('decrypted content is not a JSON object');
  }

  // Strict schema check. A default-to-public fill-in must never hide a typo or a wrong status.
  const shape = validatePublishControlsShape(data);
  if (!shape.ok) {
    const detail = shape.errors.slice(0, 5).join('; ');
    return fail(`schema validation failed (${shape.errors.length} problem(s)): ${detail}`);
  }

  return { controls: normalizePublishControls(data), failure: null };
}
