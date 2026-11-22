// Gate checks shared by data-export.mjs and data-export-dry-run.mjs (and tests/export-fail-closed.test.mjs).
//
// loadPublishControls({ encryptedDir }) -> { controls, failure }
//   controls: normalized publish controls when the file is valid, otherwise null.
//   failure:  null when valid. Otherwise { file, message }. A missing, 0-byte, undecryptable, unparseable or
//             non-object publish-controls.json.enc is ALWAYS a failure. It is never treated as "all public".
//   Callers must treat a failure as "nothing collection-gated may be exported" (see export-public.mjs).
//
// checkContentKey() -> null when CONTENT_DECRYPT_KEY is usable, otherwise one message string.

import fs from 'fs';
import path from 'path';
import { getContentKey, decryptJson } from './content-crypto.mjs';
import { ENCRYPTED_DIR } from './data-paths.mjs';
import { normalizePublishControls } from './publish-controls.mjs';

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

  return { controls: normalizePublishControls(data), failure: null };
}
