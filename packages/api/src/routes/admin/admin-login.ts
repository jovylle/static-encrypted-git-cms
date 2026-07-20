import { Env, jsonResponse, parseJsonBody, badRequest, unauthorized, serverError, errorResponse } from '../../helpers';
import { verifyPassword, createSessionToken, makeSessionCookie } from '../../middleware/auth';

export async function handleAdminLogin(env: Env, request: Request): Promise<Response> {
  if (request.method !== 'POST') return errorResponse(405, 'Method not allowed');

  let body: any;
  try {
    body = await parseJsonBody(request);
  } catch (e: any) {
    return badRequest(e.message);
  }

  const password = body.password;
  if (typeof password !== 'string' || password.length === 0) {
    return badRequest('password is required');
  }

  try {
    const ok = verifyPassword(env, password);
    if (!ok) return unauthorized('Invalid credentials');
    const token = await createSessionToken(env, 'admin');
    return jsonResponse({ ok: true }, 200, {
      'set-cookie': makeSessionCookie(token),
    });
  } catch (e: any) {
    return serverError(e.message);
  }
}
