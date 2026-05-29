import { clearSessionCookie } from './lib/admin-auth.mjs';
import { jsonResponse, methodNotAllowed } from './lib/http.mjs';

export async function handler(event) {
  if (event.httpMethod !== 'POST') return methodNotAllowed('POST');
  return jsonResponse(
    200,
    { ok: true },
    {
      'set-cookie': clearSessionCookie(),
    },
  );
}
