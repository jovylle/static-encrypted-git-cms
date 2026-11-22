// Build-time export CLI: decrypts data/encrypted/** into public/data/ and public/notifications/. Run by
// `predev` and `prebuild` (so `npm run dev` and `npm run build`). The logic lives in scripts/lib/export-public.mjs.
//
// Gotchas (details in export-public.mjs and export-gate.mjs):
// - Fail closed. Any decrypt or parse failure exits 1 after every failing file is listed. ALLOW_PARTIAL_EXPORT=1
//   turns those failures into warnings (exit 0). Missing or empty .enc files other than publish-controls are
//   warnings only.
// - publish-controls.json.enc is required. If it is missing, empty, undecryptable or unparseable, it is a
//   failure and EVERY collection is treated as NOT public (with ALLOW_PARTIAL_EXPORT=1 too: exit 0 with a
//   warning, and nothing gated is exported). A missing controls file never means "all public".
// - A missing or unusable CONTENT_DECRYPT_KEY fails fast with one message and exits 1, even with
//   ALLOW_PARTIAL_EXPORT=1, and nothing is wiped.
// - At start-up it deletes everything in public/data/ except .gitkeep and usage-metrics.json, and deletes
//   public/notifications/. A skipped file is therefore ABSENT, not empty.
// - The Worker's live routes (packages/api/src/routes/data-file.ts) apply the item and blog filters too, but
//   they do NOT read publish-controls. Only this export honors the collection gates.

import process from 'process';
import { loadDotEnv } from './lib/data-io.mjs';
import { isPartialAllowed } from './lib/decrypt-report.mjs';
import { exportPublicData } from './lib/export-public.mjs';

loadDotEnv();

const result = exportPublicData({ allowPartial: isPartialAllowed() });
for (const line of result.lines) {
  if (result.exitCode === 0) console.warn(line);
  else console.error(line);
}

if (result.exitCode === 0) {
  console.log('Public data exported to public/data/ and public/notifications/');
}
process.exitCode = result.exitCode;
