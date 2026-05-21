/** Public CDN origin for static images (no trailing slash). */
export function getContentAssetBase() {
  const fromEnv = process.env.CONTENT_PUBLIC_BASE || process.env.VITE_CONTENT_BASE;
  return (fromEnv || 'https://content.jovylle.com').replace(/\/$/, '');
}

/**
 * Rewrite legacy relative or pocket image paths to the vault CDN.
 * @param {string} url
 * @param {string} [base]
 */
export function rewriteAssetUrl(url, base = getContentAssetBase()) {
  if (!url || typeof url !== 'string') return url;
  const trimmed = url.trim();
  if (!trimmed) return url;

  if (trimmed.startsWith(base)) return trimmed;

  if (trimmed.includes('pocket.uft1.com')) {
    return trimmed.replace(/https?:\/\/pocket\.uft1\.com/g, base);
  }

  if (trimmed.startsWith('/images/')) {
    return `${base}${trimmed}`;
  }

  if (trimmed.startsWith('images/')) {
    return `${base}/${trimmed}`;
  }

  return url;
}

/** Markdown / HTML bodies may embed /images/ or pocket URLs. */
export function rewriteTextAssets(text, base = getContentAssetBase()) {
  if (!text || typeof text !== 'string') return text;
  let out = text.replace(/https?:\/\/pocket\.uft1\.com/g, base);
  // Markdown images and links: ](/images/...  or ](/images/
  out = out.replace(/\]\(\/images\//g, `](${base}/images/`);
  out = out.replace(/src="\/images\//g, `src="${base}/images/`);
  out = out.replace(/src='\/images\//g, `src='${base}/images/`);
  return out;
}

const ASSET_FIELD_KEYS = new Set(['thumbnail', 'image', 'featured_image']);
const TEXT_ASSET_KEYS = new Set(['body', 'description', 'excerpt', 'summary']);

/**
 * Deep-walk JSON content and rewrite known asset fields + blog bodies.
 */
export function transformAssetUrls(data, base = getContentAssetBase()) {
  if (data === null || data === undefined) return data;
  if (Array.isArray(data)) {
    return data.map((item) => transformAssetUrls(item, base));
  }
  if (typeof data !== 'object') return data;

  const out = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string') {
      if (ASSET_FIELD_KEYS.has(key)) {
        out[key] = rewriteAssetUrl(value, base);
      } else if (TEXT_ASSET_KEYS.has(key)) {
        out[key] = rewriteTextAssets(value, base);
      } else if (key === 'netlify_live' && value.includes('pocket.uft1.com')) {
        out[key] = 'content.jovylle.com';
      } else {
        out[key] = value;
      }
    } else {
      out[key] = transformAssetUrls(value, base);
    }
  }
  return out;
}
