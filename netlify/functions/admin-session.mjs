import { getSessionFromHeaders } from './lib/admin-auth.mjs';
import { jsonResponse, methodNotAllowed } from './lib/http.mjs';

export async function handler(event) {
  if (event.httpMethod !== 'GET') return methodNotAllowed('GET');
  const session = getSessionFromHeaders(event.headers);
  if (!session) return jsonResponse(401, { authenticated: false });
  return jsonResponse(200, {
    authenticated: true,
    user: session.sub,
    exp: session.exp,
  });
}
