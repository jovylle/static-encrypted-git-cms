import type { Env } from '../helpers';
import {
  jsonResponse,
  badRequest,
  notFound,
  generateId,
  parseJsonBody,
} from '../helpers';
import { logAudit } from './audit-logs';

export async function handleListContacts(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT id, name, email, subject, message, status, created_at FROM contact_submissions ORDER BY created_at DESC',
  ).run();
  return jsonResponse(results);
}

export async function handleGetContact(
  env: Env,
  id: string,
): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT id, name, email, subject, message, status, created_at FROM contact_submissions WHERE id = ?',
  )
    .bind(id)
    .run();

  if (!results[0]) return notFound('Contact submission not found');
  return jsonResponse(results[0]);
}

export async function handleCreateContact(
  env: Env,
  request: Request,
): Promise<Response> {
  const body = await parseJsonBody<{
    name: string;
    email: string;
    subject?: string;
    message: string;
  }>(request);

  if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
    return badRequest('name is required');
  }
  if (!body.email || typeof body.email !== 'string' || body.email.trim().length === 0) {
    return badRequest('email is required');
  }
  if (!body.message || typeof body.message !== 'string' || body.message.trim().length === 0) {
    return badRequest('message is required');
  }

  const id = generateId();
  const subject = body.subject || '';

  await env.DB.prepare(
    'INSERT INTO contact_submissions (id, name, email, subject, message) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, body.name.trim(), body.email.trim(), subject, body.message.trim())
    .run();

  const { results } = await env.DB.prepare(
    'SELECT id, name, email, subject, message, status, created_at FROM contact_submissions WHERE id = ?',
  )
    .bind(id)
    .run();

  return jsonResponse(results[0], 201);
}

export async function handleUpdateContactStatus(
  env: Env,
  id: string,
  request: Request,
  admin?: string,
): Promise<Response> {
  const body = await parseJsonBody<{ status: string }>(request);

  const validStatuses = ['unread', 'read', 'replied', 'spam'];
  if (!body.status || !validStatuses.includes(body.status)) {
    return badRequest(
      `status must be one of: ${validStatuses.join(', ')}`,
    );
  }

  const { results } = await env.DB.prepare(
    'SELECT id, status FROM contact_submissions WHERE id = ?',
  )
    .bind(id)
    .run();

  if (!results[0]) return notFound('Contact submission not found');

  const beforeStatus = results[0].status;

  await env.DB.prepare('UPDATE contact_submissions SET status = ? WHERE id = ?')
    .bind(body.status, id)
    .run();

  if (admin) {
    await logAudit(env, {
      actor: admin,
      action: 'contact.update_status',
      target_type: 'contact',
      target_id: id,
      metadata: { before: beforeStatus, after: body.status },
    });
  }

  const { results: updated } = await env.DB.prepare(
    'SELECT id, name, email, subject, message, status, created_at FROM contact_submissions WHERE id = ?',
  )
    .bind(id)
    .run();

  return jsonResponse(updated[0]);
}

export async function handleDeleteContact(
  env: Env,
  id: string,
  admin?: string,
): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT id, name, email FROM contact_submissions WHERE id = ?',
  )
    .bind(id)
    .run();

  if (!results[0]) return notFound('Contact submission not found');

  await env.DB.prepare('DELETE FROM contact_submissions WHERE id = ?')
    .bind(id)
    .run();

  if (admin) {
    await logAudit(env, {
      actor: admin,
      action: 'contact.delete',
      target_type: 'contact',
      target_id: id,
      metadata: { deleted: results[0] },
    });
  }

  return jsonResponse({ deleted: true });
}
