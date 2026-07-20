import { Env, jsonResponse, parseJsonBody, badRequest, serverError } from '../../helpers';
import { getAdminCollectionByKey, defaultDataForCollection } from '../../lib/admin-collections';
import { readEncryptedJsonFile, writeEncryptedJsonFile } from '../../lib/encrypted-content-store';
import { validateCollectionData } from '../../lib/validate-collection';

export async function handleAdminCollectionGet(env: Env, key: string): Promise<Response> {
  try {
    const collection = getAdminCollectionByKey(key);
    if (!collection) return badRequest('Unknown collection');
    if (collection.multiFile) return badRequest('Use the blog or notification bundle API for this collection');
    if (!collection.filePath) return badRequest('No file path for this collection');

    const { data } = await readEncryptedJsonFile(
      env, collection.filePath, defaultDataForCollection(collection.key),
    );
    return jsonResponse({
      ok: true,
      collection: { key: collection.key, label: collection.label },
      data,
    });
  } catch (e: any) {
    if (e.message.includes('Unknown collection')) return badRequest(e.message);
    return serverError(e.message);
  }
}

export async function handleAdminCollectionPost(
  env: Env,
  request: Request,
  adminUser: string,
): Promise<Response> {
  let body: any;
  try {
    body = await parseJsonBody(request);
  } catch (e: any) {
    return badRequest(e.message);
  }

  try {
    const colKey = body.collection || body.key;
    const collection = getAdminCollectionByKey(colKey);
    if (!collection) return badRequest('Unknown collection');
    if (collection.multiFile) return badRequest('Use the blog or notification bundle API for this collection');
    if (!collection.filePath) return badRequest('No file path for this collection');
    if (body.data === undefined) return badRequest('data is required');

    const validation = await validateCollectionData(collection.key, body.data);
    if (!validation.ok) {
      return jsonResponse({ error: 'Validation failed', validationErrors: validation.errors }, 400);
    }

    const { sha } = await readEncryptedJsonFile(
      env, collection.filePath, defaultDataForCollection(collection.key),
    );
    const write = await writeEncryptedJsonFile(env, {
      filePath: collection.filePath,
      data: body.data,
      sha,
      actor: adminUser,
      branchHint: `json-${collection.key}`,
      message: `admin: update ${collection.key}.json`,
    });

    return jsonResponse({
      ok: true,
      collection: { key: collection.key, label: collection.label },
      write,
    });
  } catch (e: any) {
    if (e.message.includes('Unknown collection')) return badRequest(e.message);
    return serverError(e.message);
  }
}
