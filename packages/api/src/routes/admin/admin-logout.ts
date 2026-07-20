import { Env, jsonResponse, errorResponse } from '../../helpers';
import { clearSessionCookie } from '../../middleware/auth';

export async function handleAdminLogout(_env: Env, request: Request): Promise<Response> {
  if (request.method !== 'POST') return errorResponse(405, 'Method not allowed');

  return jsonResponse({ ok: true }, 200, {
    'set-cookie': clearSessionCookie(),
  });
}
