import { getAuthenticatedAdmin } from './lib/admin-auth.mjs';
import { readEncryptedJsonFile } from './lib/encrypted-content-store.mjs';
import { jsonResponse, methodNotAllowed, serverError, unauthorized } from './lib/http.mjs';
import { normalizePublishControls } from './lib/visibility-mutators.mjs';

export async function handler(event) {
  if (event.httpMethod !== 'GET') return methodNotAllowed('GET');
  const admin = getAuthenticatedAdmin(event.headers);
  if (!admin) return unauthorized();

  try {
    const [{ data: personal }, controlsFile] = await Promise.all([
      readEncryptedJsonFile('data/encrypted/personal-projects.json.enc'),
      readEncryptedJsonFile('data/encrypted/publish-controls.json.enc', {
        collections: {
          'personal-projects': 'public',
          projects: 'public',
          highlights: 'public',
          profile: 'public',
          resume: 'public',
          blogs: 'public',
        },
      }),
    ]);

    const controls = normalizePublishControls(controlsFile.data);
    const projects = Array.isArray(personal.projects)
      ? personal.projects.map((p) => ({
          slug: p.slug,
          title: p.title,
          status: p.status,
          private: p.private === true,
          updated_at: p.updated_at,
        }))
      : [];

    return jsonResponse(200, {
      ok: true,
      controls,
      projects,
    });
  } catch (e) {
    return serverError(e.message);
  }
}
