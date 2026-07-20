import { Env, jsonResponse, errorResponse } from '../../helpers';
import { parseCookies, verifySessionToken } from '../../middleware/auth';

export async function handleAdminSession(env: Env, request: Request): Promise<Response> {
  if (request.method !== 'GET') return errorResponse(405, 'Method not allowed');

  const cookies = parseCookies(request.headers);
  const token = cookies['admin_session'];
  if (!token) return jsonResponse({ authenticated: false }, 401);

  const session = await verifySessionToken(env, token);
  if (!session) return jsonResponse({ authenticated: false }, 401);

  return jsonResponse({
    authenticated: true,
    user: session.sub,
    exp: session.exp,
  });
}
