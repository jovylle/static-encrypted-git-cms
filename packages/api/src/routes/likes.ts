import type { Env } from '../helpers';
import { jsonResponse, badRequest, generateId, parseJsonBody, getQueryParam } from '../helpers';

export async function handleToggleLike(
  env: Env,
  request: Request,
): Promise<Response> {
  const body = await parseJsonBody<{
    target_type: string;
    target_id: string;
    visitor_id: string;
  }>(request);

  if (!body.target_type || !body.target_id || !body.visitor_id) {
    return badRequest('target_type, target_id, and visitor_id are required');
  }

  const { results } = await env.DB.prepare(
    'SELECT id FROM likes WHERE target_type = ? AND target_id = ? AND visitor_id = ?',
  ).bind(body.target_type, body.target_id, body.visitor_id).run();

  if (results[0]) {
    await env.DB.prepare('DELETE FROM likes WHERE id = ?').bind(results[0].id).run();
    const { results: count } = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM likes WHERE target_type = ? AND target_id = ?',
    ).bind(body.target_type, body.target_id).run();
    return jsonResponse({ liked: false, count: count[0].count });
  }

  const id = generateId();
  await env.DB.prepare(
    'INSERT INTO likes (id, target_type, target_id, visitor_id) VALUES (?, ?, ?, ?)',
  ).bind(id, body.target_type, body.target_id, body.visitor_id).run();

  const { results: count } = await env.DB.prepare(
    'SELECT COUNT(*) as count FROM likes WHERE target_type = ? AND target_id = ?',
  ).bind(body.target_type, body.target_id).run();

  return jsonResponse({ liked: true, count: count[0].count });
}

export async function handleGetLikeCount(env: Env, request: Request): Promise<Response> {
  const targetType = getQueryParam(request.url, 'target_type');
  const targetId = getQueryParam(request.url, 'target_id');

  if (!targetType || !targetId) {
    return badRequest('target_type and target_id are required');
  }

  const { results } = await env.DB.prepare(
    'SELECT COUNT(*) as count FROM likes WHERE target_type = ? AND target_id = ?',
  ).bind(targetType, targetId).run();

  return jsonResponse({ target_type: targetType, target_id: targetId, count: results[0].count });
}
