import type { Env } from '../helpers';

function corsHeadersAllowed(origin: string): Record<string, string> {
  const headers: Record<string, string> = {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'access-control-allow-headers': 'Content-Type, Authorization',
    'access-control-max-age': '86400',
  };
  if (origin !== '*') {
    headers['access-control-allow-credentials'] = 'true';
  }
  return headers;
}

export function handleCors(request: Request, env: Env): Response | null {
  if (request.method !== 'OPTIONS') return null;

  const origin = request.headers.get('origin') || env.CORS_ORIGIN || '*';
  const allowed = env.CORS_ORIGIN === '*' ? '*' : origin;
  return new Response(null, {
    status: 204,
    headers: corsHeadersAllowed(allowed),
  });
}

export function addCorsHeaders(response: Response, env: Env): Response {
  const origin = env.CORS_ORIGIN || '*';
  const headers = corsHeadersAllowed(origin);
  const newResponse = new Response(response.body, response);
  for (const [key, value] of Object.entries(headers)) {
    newResponse.headers.set(key, value);
  }
  return newResponse;
}
