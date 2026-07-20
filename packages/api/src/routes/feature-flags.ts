import type { Env } from '../helpers';
import {
  jsonResponse,
  errorResponse,
  badRequest,
  notFound,
  generateId,
  parseJsonBody,
} from '../helpers';
import { logAudit } from './audit-logs';

export async function handleListFeatureFlags(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT id, key, enabled, description, created_at, updated_at FROM feature_flags ORDER BY key ASC',
  ).run();
  return jsonResponse(results);
}

export async function handleGetFeatureFlag(
  env: Env,
  key: string,
): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT id, key, enabled, description, created_at, updated_at FROM feature_flags WHERE key = ?',
  )
    .bind(key)
    .run();

  const flag = results[0];
  if (!flag) return notFound('Feature flag not found');
  return jsonResponse(flag);
}

export async function handleCreateFeatureFlag(
  env: Env,
  request: Request,
  admin?: string,
): Promise<Response> {
  const body = await parseJsonBody<{
    key: string;
    enabled?: boolean;
    description?: string;
  }>(request);

  if (!body.key || typeof body.key !== 'string' || body.key.trim().length === 0) {
    return badRequest('key is required');
  }

  const id = generateId();
  const key = body.key.trim();
  const enabled = body.enabled ? 1 : 0;
  const description = body.description || '';

  try {
    await env.DB.prepare(
      'INSERT INTO feature_flags (id, key, enabled, description) VALUES (?, ?, ?, ?)',
    )
      .bind(id, key, enabled, description)
      .run();

    if (admin) {
      await logAudit(env, {
        actor: admin,
        action: 'feature_flag.create',
        target_type: 'feature_flag',
        target_id: key,
        metadata: { enabled, description },
      });
    }

    const { results } = await env.DB.prepare(
      'SELECT id, key, enabled, description, created_at, updated_at FROM feature_flags WHERE id = ?',
    )
      .bind(id)
      .run();

    return jsonResponse(results[0], 201);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UNIQUE constraint')) {
      return errorResponse(409, `Feature flag with key '${key}' already exists`);
    }
    throw err;
  }
}

export async function handleUpdateFeatureFlag(
  env: Env,
  key: string,
  request: Request,
  admin?: string,
): Promise<Response> {
  const body = await parseJsonBody<{
    enabled?: boolean;
    description?: string;
  }>(request);

  const { results } = await env.DB.prepare(
    'SELECT id, enabled, description FROM feature_flags WHERE key = ?',
  )
    .bind(key)
    .run();

  if (!results[0]) return notFound('Feature flag not found');

  const before = { enabled: results[0].enabled, description: results[0].description };

  const sets: string[] = [];
  const params: unknown[] = [];

  if (body.enabled !== undefined) {
    sets.push('enabled = ?');
    params.push(body.enabled ? 1 : 0);
  }
  if (body.description !== undefined) {
    sets.push('description = ?');
    params.push(body.description);
  }

  if (sets.length === 0) {
    return badRequest('No fields to update');
  }

  sets.push("updated_at = datetime('now')");
  params.push(key);

  await env.DB.prepare(
    `UPDATE feature_flags SET ${sets.join(', ')} WHERE key = ?`,
  )
    .bind(...params)
    .run();

  if (admin) {
    await logAudit(env, {
      actor: admin,
      action: 'feature_flag.update',
      target_type: 'feature_flag',
      target_id: key,
      metadata: { before, after: body },
    });
  }

  const { results: updated } = await env.DB.prepare(
    'SELECT id, key, enabled, description, created_at, updated_at FROM feature_flags WHERE key = ?',
  )
    .bind(key)
    .run();

  return jsonResponse(updated[0]);
}

export async function handleDeleteFeatureFlag(
  env: Env,
  key: string,
  admin?: string,
): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT id, key, enabled, description FROM feature_flags WHERE key = ?',
  )
    .bind(key)
    .run();

  if (!results[0]) return notFound('Feature flag not found');

  await env.DB.prepare('DELETE FROM feature_flags WHERE key = ?')
    .bind(key)
    .run();

  if (admin) {
    await logAudit(env, {
      actor: admin,
      action: 'feature_flag.delete',
      target_type: 'feature_flag',
      target_id: key,
      metadata: { deleted: results[0] },
    });
  }

  return jsonResponse({ deleted: true });
}
