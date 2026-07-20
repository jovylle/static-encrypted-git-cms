import type { Env } from '../helpers';
import { jsonResponse, generateId } from '../helpers';

export interface AuditLogEntry {
  actor: string;
  action: string;
  target_type?: string;
  target_id?: string;
  metadata?: Record<string, unknown>;
}

export async function logAudit(
  env: Env,
  entry: AuditLogEntry,
): Promise<void> {
  const id = generateId();
  const metadata = entry.metadata ? JSON.stringify(entry.metadata) : null;

  await env.DB.prepare(
    'INSERT INTO audit_logs (id, actor, action, target_type, target_id, metadata) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(
      id,
      entry.actor,
      entry.action,
      entry.target_type || null,
      entry.target_id || null,
      metadata,
    )
    .run();
}

export async function handleListAuditLogs(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT id, actor, action, target_type, target_id, metadata, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 100',
  ).run();

  const parsed = results.map((row: Record<string, unknown>) => ({
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata as string) : null,
  }));

  return jsonResponse(parsed);
}
