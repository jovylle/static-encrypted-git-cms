import { Env, jsonResponse } from '../../helpers';
import { listAdminCollections } from '../../lib/admin-collections';

export async function handleAdminCollections(_env: Env): Promise<Response> {
  return jsonResponse({
    ok: true,
    collections: listAdminCollections(),
  });
}
