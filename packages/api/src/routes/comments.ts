import type { Env } from '../helpers';
import { jsonResponse, badRequest, notFound, generateId, parseJsonBody, getQueryParam } from '../helpers';
import { logAudit } from './audit-logs';

export async function handleListApprovedComments(env: Env, request: Request): Promise<Response> {
  const targetType = getQueryParam(request.url, 'target_type');
  const targetId = getQueryParam(request.url, 'target_id');

  if (!targetType || !targetId) {
    return badRequest('target_type and target_id are required');
  }

  const { results } = await env.DB.prepare(
    "SELECT id, target_type, target_id, author_name, content, created_at FROM comments WHERE target_type = ? AND target_id = ? AND status = 'approved' ORDER BY created_at ASC",
  ).bind(targetType, targetId).run();

  return jsonResponse(results);
}

export async function handleCreateComment(
  env: Env,
  request: Request,
): Promise<Response> {
  const body = await parseJsonBody<{
    target_type: string;
    target_id: string;
    author_name: string;
    author_email?: string;
    content: string;
  }>(request);

  if (!body.target_type || !body.target_id || !body.author_name || !body.content) {
    return badRequest('target_type, target_id, author_name, and content are required');
  }

  const id = generateId();

  await env.DB.prepare(
    'INSERT INTO comments (id, target_type, target_id, author_name, author_email, content) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(id, body.target_type, body.target_id, body.author_name, body.author_email || null, body.content).run();

  const { results } = await env.DB.prepare(
    'SELECT id, target_type, target_id, author_name, content, status, created_at FROM comments WHERE id = ?',
  ).bind(id).run();

  return jsonResponse(results[0], 201);
}

export async function handleListAllComments(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT id, target_type, target_id, author_name, author_email, content, status, created_at FROM comments ORDER BY created_at DESC',
  ).run();
  return jsonResponse(results);
}

export async function handleUpdateCommentStatus(
  env: Env,
  id: string,
  request: Request,
  admin?: string,
): Promise<Response> {
  const body = await parseJsonBody<{ status: string }>(request);
  const validStatuses = ['approved', 'rejected', 'spam'];
  if (!body.status || !validStatuses.includes(body.status)) {
    return badRequest(`status must be one of: ${validStatuses.join(', ')}`);
  }

  const { results } = await env.DB.prepare(
    'SELECT id, status FROM comments WHERE id = ?',
  ).bind(id).run();
  if (!results[0]) return notFound('Comment not found');

  const before = { status: results[0].status };
  const newStatus = body.status;

  await env.DB.prepare('UPDATE comments SET status = ? WHERE id = ?')
    .bind(newStatus, id).run();

  if (admin) {
    await logAudit(env, {
      actor: admin,
      action: `comment.${newStatus}`,
      target_type: 'comment',
      target_id: id,
      metadata: { before, after: { status: newStatus } },
    });
  }

  const { results: updated } = await env.DB.prepare(
    'SELECT id, target_type, target_id, author_name, content, status, created_at FROM comments WHERE id = ?',
  ).bind(id).run();

  return jsonResponse(updated[0]);
}

export async function handleDeleteComment(
  env: Env,
  id: string,
  admin?: string,
): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT id, target_type, target_id FROM comments WHERE id = ?',
  ).bind(id).run();
  if (!results[0]) return notFound('Comment not found');

  await env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(id).run();

  if (admin) {
    await logAudit(env, {
      actor: admin,
      action: 'comment.delete',
      target_type: 'comment',
      target_id: id,
      metadata: { deleted: results[0] },
    });
  }

  return jsonResponse({ deleted: true });
}
