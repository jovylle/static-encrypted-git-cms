import { Env, jsonResponse, parseJsonBody, badRequest, serverError } from '../../helpers';
import { readEncryptedJsonFile, writeEncryptedJsonFile } from '../../lib/encrypted-content-store';
import { applyProjectVisibilityUpdate } from '../../lib/visibility-mutators';

export async function handleAdminProjectVisibility(
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

  if (body.status === undefined && body.private === undefined) {
    return badRequest('At least one of status or private must be provided');
  }

  try {
    const { data, sha } = await readEncryptedJsonFile(
      env,
      'data/encrypted/personal-projects.json.enc',
    );
    const updated = applyProjectVisibilityUpdate(data, body);
    const write = await writeEncryptedJsonFile(env, {
      filePath: 'data/encrypted/personal-projects.json.enc',
      data,
      sha,
      actor: adminUser,
      branchHint: updated.slug || 'project',
      message: `admin: update personal project visibility (${updated.slug})`,
    });

    return jsonResponse({
      ok: true,
      project: {
        slug: updated.slug,
        status: updated.status,
        private: updated.private,
      },
      write,
    });
  } catch (e: any) {
    if (
      e.message.includes('required') ||
      e.message.includes('must be') ||
      e.message.includes('not found')
    ) {
      return badRequest(e.message);
    }
    return serverError(e.message);
  }
}
