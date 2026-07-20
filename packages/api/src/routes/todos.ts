import type { Env } from '../helpers';
import { jsonResponse, badRequest, notFound, generateId, parseJsonBody } from '../helpers';
import { logAudit } from './audit-logs';

export async function handleListTodos(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT id, title, content, status, priority, created_at, updated_at FROM todos ORDER BY priority DESC, created_at ASC',
  ).run();
  return jsonResponse(results);
}

export async function handleGetTodo(env: Env, id: string): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT id, title, content, status, priority, created_at, updated_at FROM todos WHERE id = ?',
  ).bind(id).run();
  if (!results[0]) return notFound('Todo not found');
  return jsonResponse(results[0]);
}

export async function handleCreateTodo(
  env: Env,
  request: Request,
  admin?: string,
): Promise<Response> {
  const body = await parseJsonBody<{
    title: string;
    content?: string;
    status?: string;
    priority?: number;
  }>(request);

  if (!body.title || typeof body.title !== 'string' || body.title.trim().length === 0) {
    return badRequest('title is required');
  }

  const validStatuses = ['open', 'in_progress', 'done'];
  const status = body.status && validStatuses.includes(body.status) ? body.status : 'open';
  const id = generateId();
  const title = body.title.trim();
  const content = body.content || '';
  const priority = typeof body.priority === 'number' ? body.priority : 0;

  await env.DB.prepare(
    'INSERT INTO todos (id, title, content, status, priority) VALUES (?, ?, ?, ?, ?)',
  ).bind(id, title, content, status, priority).run();

  if (admin) {
    await logAudit(env, {
      actor: admin,
      action: 'todo.create',
      target_type: 'todo',
      target_id: id,
      metadata: { title, status, priority },
    });
  }

  const { results } = await env.DB.prepare(
    'SELECT id, title, content, status, priority, created_at, updated_at FROM todos WHERE id = ?',
  ).bind(id).run();

  return jsonResponse(results[0], 201);
}

export async function handleUpdateTodo(
  env: Env,
  id: string,
  request: Request,
  admin?: string,
): Promise<Response> {
  const body = await parseJsonBody<{
    title?: string;
    content?: string;
    status?: string;
    priority?: number;
  }>(request);

  const { results } = await env.DB.prepare(
    'SELECT id, title, content, status, priority FROM todos WHERE id = ?',
  ).bind(id).run();
  if (!results[0]) return notFound('Todo not found');

  const validStatuses = ['open', 'in_progress', 'done'];
  const before = { ...results[0] };
  const sets: string[] = [];
  const params: unknown[] = [];

  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || body.title.trim().length === 0) {
      return badRequest('title cannot be empty');
    }
    sets.push('title = ?');
    params.push(body.title.trim());
  }
  if (body.content !== undefined) {
    sets.push('content = ?');
    params.push(body.content);
  }
  if (body.status !== undefined) {
    if (!validStatuses.includes(body.status)) {
      return badRequest(`status must be one of: ${validStatuses.join(', ')}`);
    }
    sets.push('status = ?');
    params.push(body.status);
  }
  if (body.priority !== undefined) {
    sets.push('priority = ?');
    params.push(body.priority);
  }

  if (sets.length === 0) {
    return badRequest('No fields to update');
  }

  sets.push("updated_at = datetime('now')");
  params.push(id);

  await env.DB.prepare(
    `UPDATE todos SET ${sets.join(', ')} WHERE id = ?`,
  ).bind(...params).run();

  if (admin) {
    const { results: after } = await env.DB.prepare(
      'SELECT id, title, content, status, priority FROM todos WHERE id = ?',
    ).bind(id).run();
    await logAudit(env, {
      actor: admin,
      action: 'todo.update',
      target_type: 'todo',
      target_id: id,
      metadata: { before, after: after[0] },
    });
  }

  const { results: updated } = await env.DB.prepare(
    'SELECT id, title, content, status, priority, created_at, updated_at FROM todos WHERE id = ?',
  ).bind(id).run();

  return jsonResponse(updated[0]);
}

export async function handleDeleteTodo(
  env: Env,
  id: string,
  admin?: string,
): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT id, title FROM todos WHERE id = ?',
  ).bind(id).run();
  if (!results[0]) return notFound('Todo not found');

  await env.DB.prepare('DELETE FROM todos WHERE id = ?').bind(id).run();

  if (admin) {
    await logAudit(env, {
      actor: admin,
      action: 'todo.delete',
      target_type: 'todo',
      target_id: id,
      metadata: { deleted: { title: results[0].title } },
    });
  }

  return jsonResponse({ deleted: true });
}
