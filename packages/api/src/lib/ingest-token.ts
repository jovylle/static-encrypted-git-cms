import crypto from 'node:crypto';

/**
 * Bearer-token auth for non-interactive callers (scripts/webhooks), kept in a
 * completely separate secret space from ADMIN_PASSWORD/ADMIN_SESSION_SECRET so
 * revoking one token never touches the human session or other tokens.
 *
 * INGEST_TOKENS format: comma-separated entries of
 *   tokenId:secretToken:collectionKey1|collectionKey2|...:writeMode
 * e.g. INGEST_TOKENS="ci-blogs:s3cr3t-abc:blogs,ci-notify:s3cr3t-xyz:notifications|blogs"
 * Collection keys must match the editable-collection registry keys.
 *
 * The trailing `writeMode` field is optional and defaults to `'pr'` when
 * omitted, so existing entries keep working unchanged. Set it to `'commit'`
 * to let that specific token write straight to master instead of opening a
 * PR — e.g. INGEST_TOKENS="ci-fast-scores:s3cr3t-fast:fast-scores:commit".
 * Any other value (or omission) falls back to `'pr'`.
 *
 * NOTE: This module is intentionally NOT wired into the live Cloudflare Worker
 * router. The deployed admin surface authenticates via Basic auth + session
 * cookie (see middleware/auth.ts). This ingest-token model is retained for its
 * test coverage and for reuse by out-of-band ingestion tooling that reads
 * `process.env.INGEST_TOKENS` in a Node context.
 */

export type IngestWriteMode = 'commit' | 'pr';

export interface IngestToken {
  tokenId: string;
  allowedCollections: string[];
  writeMode: IngestWriteMode;
}

interface IngestTokenEntry {
  tokenId: string;
  secret: string;
  collections: string[];
  writeMode: IngestWriteMode;
}

type HeaderBag = Record<string, string | undefined>;

function parseIngestTokens(): IngestTokenEntry[] {
  const raw = process.env.INGEST_TOKENS || '';
  const entries: IngestTokenEntry[] = [];
  for (const chunk of raw.split(',')) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const [tokenId, secret, collectionsText, writeModeText] = trimmed.split(':');
    if (!tokenId || !secret || !collectionsText) continue;
    const collections = collectionsText
      .split('|')
      .map((c) => c.trim())
      .filter(Boolean);
    if (collections.length === 0) continue;
    const writeMode: IngestWriteMode = writeModeText?.trim() === 'commit' ? 'commit' : 'pr';
    entries.push({
      tokenId: tokenId.trim(),
      secret: secret.trim(),
      collections,
      writeMode,
    });
  }
  return entries;
}

export function getAuthenticatedIngestToken(headers: HeaderBag = {}): IngestToken | null {
  const raw = headers.authorization || headers.Authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(String(raw).trim());
  if (!match) return null;
  const presented = match[1].trim();
  if (!presented) return null;

  for (const entry of parseIngestTokens()) {
    if (entry.secret.length !== presented.length) continue;
    if (!crypto.timingSafeEqual(Buffer.from(entry.secret), Buffer.from(presented))) continue;
    return {
      tokenId: entry.tokenId,
      allowedCollections: entry.collections,
      writeMode: entry.writeMode,
    };
  }
  return null;
}

export function isCollectionAllowedForToken(
  token: IngestToken | null,
  collectionKey: string,
): boolean {
  return Boolean(token?.allowedCollections?.includes(collectionKey));
}
