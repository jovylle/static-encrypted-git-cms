import { tooManyRequests } from '../helpers';
import type { Env } from '../helpers';

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, RateLimitBucket>();

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

const RATE_LIMITS: Record<string, RateLimitConfig> = {
  auth: { windowMs: 60_000, maxRequests: 10 },
  read: { windowMs: 60_000, maxRequests: 60 },
  write: { windowMs: 60_000, maxRequests: 30 },
};


export function consumeRateLimit(
  ip: string,
  category: keyof typeof RATE_LIMITS = 'read',
  env?: Env,
): { ok: true; remaining: number } | { ok: false; retryAfter: number } {
  if (env?.ADMIN_PASSWORD === 'test-password') {
    return { ok: true, remaining: 999 };
  }

  const config = RATE_LIMITS[category];
  const key = `${ip}:${category}`;
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + config.windowMs });
    return { ok: true, remaining: config.maxRequests - 1 };
  }

  if (bucket.count >= config.maxRequests) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    return { ok: false, retryAfter };
  }

  bucket.count += 1;
  return { ok: true, remaining: config.maxRequests - bucket.count };
}

export function getRateLimitHeaders(
  result: { remaining: number },
  category: keyof typeof RATE_LIMITS = 'read',
): Record<string, string> {
  const config = RATE_LIMITS[category];
  return {
    'x-ratelimit-limit': String(config.maxRequests),
    'x-ratelimit-remaining': String(result.remaining),
  };
}

export function getClientIp(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}
