export interface Env {
  DB: D1Database;
  ADMIN_PASSWORD: string;
  ADMIN_PASSWORD_HASH?: string;
  ADMIN_SESSION_SECRET?: string;
  ADMIN_SESSION_TTL_SECONDS?: string;
  CORS_ORIGIN: string;
  CONTENT_DECRYPT_KEY?: string;
  GITHUB_TOKEN?: string;
  GITHUB_REPO?: string;
  GITHUB_BRANCH?: string;
  ADMIN_GITHUB_WRITE_MODE?: string;
}

export function generateId(): string {
  return crypto.randomUUID();
}

export function jsonResponse(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

export function errorResponse(status: number, message: string): Response {
  return jsonResponse({ error: message }, status);
}

export function badRequest(message: string): Response {
  return errorResponse(400, message);
}

export function unauthorized(message = 'Unauthorized'): Response {
  return errorResponse(401, message);
}

export function forbidden(message = 'Forbidden'): Response {
  return errorResponse(403, message);
}

export function notFound(message = 'Not found'): Response {
  return errorResponse(404, message);
}

export function methodNotAllowed(allowed: string[]): Response {
  return errorResponse(405, 'Method not allowed');
}

export function tooManyRequests(retryAfter: number): Response {
  return new Response(JSON.stringify({ error: 'Too many requests' }), {
    status: 429,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'retry-after': String(retryAfter),
    },
  });
}

export function serverError(message = 'Internal server error'): Response {
  return errorResponse(500, message);
}

export async function parseJsonBody<T = Record<string, unknown>>(
  request: Request,
): Promise<T> {
  const text = await request.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error('Invalid JSON body');
  }
}

export function getQueryParam(url: string, key: string): string | null {
  return new URL(url).searchParams.get(key);
}

export function getQueryParams(url: string, key: string): string[] {
  return new URL(url).searchParams.getAll(key);
}

export function corsHeaders(origin: string): Record<string, string> {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'access-control-allow-headers': 'Content-Type, Authorization',
    'access-control-max-age': '86400',
  };
}
