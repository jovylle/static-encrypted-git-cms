import { Env, jsonResponse, parseJsonBody, badRequest, serverError } from '../../helpers';
import { readEncryptedJsonFile, writeEncryptedJsonFile } from '../../lib/encrypted-content-store';
import { applyCollectionVisibilityUpdate } from '../../lib/visibility-mutators';

export async function handleAdminCollectionVisibility(
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
    const { data, sha } = await readEncryptedJsonFile(
      env,
      'data/encrypted/publish-controls.json.enc',
      {
        collections: {
          'personal-projects': 'public',
          projects: 'public',
          highlights: 'public',
          profile: 'public',
          resume: 'public',
          blogs: 'public',
        },
      },
    );
    const controls = applyCollectionVisibilityUpdate(data, body);
    const write = await writeEncryptedJsonFile(env, {
      filePath: 'data/encrypted/publish-controls.json.enc',
      data: controls,
      sha,
      actor: adminUser,
      branchHint: 'publish-controls',
      message:
        body.collection && body.status
          ? `admin: set collection ${body.collection}=${body.status}`
          : `admin: set collection personal-projects=${
              controls.collections?.['personal-projects'] || 'public'
            }`,
    });

    return jsonResponse({
      ok: true,
      controls,
      write,
    });
  } catch (e: any) {
    if (e.message.includes('must be') || e.message.includes('required')) {
      return badRequest(e.message);
    }
    return serverError(e.message);
  }
}
