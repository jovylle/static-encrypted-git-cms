import { getAuthenticatedAdmin } from './lib/admin-auth.mjs';
import { listAdminCollections } from './lib/admin-collections.mjs';
import { jsonResponse, methodNotAllowed, unauthorized } from './lib/http.mjs';

export async function handler(event) {
  if (event.httpMethod !== 'GET') return methodNotAllowed('GET');
  const admin = getAuthenticatedAdmin(event.headers);
  if (!admin) return unauthorized();

  return jsonResponse(200, {
    ok: true,
    collections: listAdminCollections(),
  });
}
