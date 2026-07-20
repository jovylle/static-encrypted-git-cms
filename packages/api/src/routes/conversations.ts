import type { Env } from '../helpers';
import { jsonResponse, badRequest, notFound, generateId, parseJsonBody } from '../helpers';
import { logAudit } from './audit-logs';

export async function handleListConversations(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT id, title, created_at, updated_at FROM conversations ORDER BY updated_at DESC',
  ).run();
  return jsonResponse(results);
}

export async function handleGetConversation(env: Env, id: string): Promise<Response> {
  const { results: conv } = await env.DB.prepare(
    'SELECT id, title, created_at, updated_at FROM conversations WHERE id = ?',
  ).bind(id).run();
  if (!conv[0]) return notFound('Conversation not found');

  const { results: msgs } = await env.DB.prepare(
    'SELECT id, role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
  ).bind(id).run();

  return jsonResponse({ ...conv[0], messages: msgs });
}

export async function handleCreateConversation(
  env: Env,
  request: Request,
): Promise<Response> {
  const body = await parseJsonBody<{ title?: string; message?: string }>(request);
  if (!body.message || typeof body.message !== 'string' || body.message.trim().length === 0) {
    return badRequest('Initial message is required');
  }

  const convId = generateId();
  const msgId = generateId();
  const title = body.title?.trim() || body.message.slice(0, 100);

  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO conversations (id, title) VALUES (?, ?)',
    ).bind(convId, title),
    env.DB.prepare(
      'INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)',
    ).bind(msgId, convId, 'user', body.message.trim()),
  ]);

  const { results: conv } = await env.DB.prepare(
    'SELECT id, title, created_at, updated_at FROM conversations WHERE id = ?',
  ).bind(convId).run();

  return jsonResponse({ ...conv[0], messages: [{ id: msgId, role: 'user', content: body.message.trim() }] }, 201);
}

export async function handleUpdateConversation(
  env: Env,
  id: string,
  request: Request,
  admin?: string,
): Promise<Response> {
  const body = await parseJsonBody<{ title?: string }>(request);
  if (!body.title || typeof body.title !== 'string' || body.title.trim().length === 0) {
    return badRequest('title is required');
  }

  const { results } = await env.DB.prepare(
    'SELECT id, title FROM conversations WHERE id = ?',
  ).bind(id).run();
  if (!results[0]) return notFound('Conversation not found');

  const before = { title: results[0].title };
  const title = body.title.trim();

  await env.DB.prepare(
    "UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ?",
  ).bind(title, id).run();

  if (admin) {
    await logAudit(env, {
      actor: admin,
      action: 'conversation.update',
      target_type: 'conversation',
      target_id: id,
      metadata: { before, after: { title } },
    });
  }

  const { results: updated } = await env.DB.prepare(
    'SELECT id, title, created_at, updated_at FROM conversations WHERE id = ?',
  ).bind(id).run();

  return jsonResponse(updated[0]);
}

export async function handleDeleteConversation(
  env: Env,
  id: string,
  admin?: string,
): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT id, title FROM conversations WHERE id = ?',
  ).bind(id).run();
  if (!results[0]) return notFound('Conversation not found');

  await env.DB.prepare('DELETE FROM conversations WHERE id = ?').bind(id).run();

  if (admin) {
    await logAudit(env, {
      actor: admin,
      action: 'conversation.delete',
      target_type: 'conversation',
      target_id: id,
      metadata: { deleted: { title: results[0].title } },
    });
  }

  return jsonResponse({ deleted: true });
}

export async function handleAddMessage(
  env: Env,
  conversationId: string,
  request: Request,
): Promise<Response> {
  const body = await parseJsonBody<{ role?: string; content?: string }>(request);
  if (!body.content || typeof body.content !== 'string' || body.content.trim().length === 0) {
    return badRequest('content is required');
  }

  const { results } = await env.DB.prepare(
    'SELECT id FROM conversations WHERE id = ?',
  ).bind(conversationId).run();
  if (!results[0]) return notFound('Conversation not found');

  const msgId = generateId();
  const role = body.role || 'user';

  await env.DB.prepare(
    "UPDATE conversations SET updated_at = datetime('now') WHERE id = ?",
  ).bind(conversationId).run();

  await env.DB.prepare(
    'INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)',
  ).bind(msgId, conversationId, role, body.content.trim()).run();

  const { results: msg } = await env.DB.prepare(
    'SELECT id, role, content, created_at FROM messages WHERE id = ?',
  ).bind(msgId).run();

  return jsonResponse(msg[0], 201);
}
