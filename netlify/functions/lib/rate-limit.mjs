const buckets = new Map();

function now() {
  return Date.now();
}

export function consumeRateLimit({
  key,
  windowMs = 60_000,
  maxRequests = 15,
}) {
  const t = now();
  const bucket = buckets.get(key);
  if (!bucket || t > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: t + windowMs });
    return { ok: true, remaining: maxRequests - 1 };
  }
  if (bucket.count >= maxRequests) {
    return { ok: false, retryAfterSeconds: Math.ceil((bucket.resetAt - t) / 1000) };
  }
  bucket.count += 1;
  return { ok: true, remaining: maxRequests - bucket.count };
}
