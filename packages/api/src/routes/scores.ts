import type { Env } from '../helpers';
import { jsonResponse, badRequest, notFound, generateId, parseJsonBody, getQueryParam } from '../helpers';
import { logAudit } from './audit-logs';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 200;

export async function handleListScores(env: Env, request: Request): Promise<Response> {
  const game = getQueryParam(request.url, 'game');
  const sort = getQueryParam(request.url, 'sort') === 'top' ? 'top' : 'recent';

  let limit = DEFAULT_LIMIT;
  const rawLimit = getQueryParam(request.url, 'limit');
  if (rawLimit !== null) {
    const parsed = parseInt(rawLimit, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      limit = Math.min(parsed, MAX_LIMIT);
    }
  }

  const orderBy = sort === 'top' ? 'ms ASC, created_at DESC' : 'created_at DESC';
  const where = game ? 'WHERE game = ?' : '';
  const binds: unknown[] = [];
  if (game) binds.push(game);
  binds.push(limit);

  const { results } = await env.DB.prepare(
    `SELECT id, game, ms, player_name, player_id, created_at FROM scores ${where} ORDER BY ${orderBy} LIMIT ?`,
  ).bind(...binds).run();

  return jsonResponse({ scores: results });
}

export async function handleCreateScore(
  env: Env,
  request: Request,
  admin?: string,
): Promise<Response> {
  const body = await parseJsonBody<{
    game: string;
    ms: number;
    playerName: string;
    playerId: string;
  }>(request);

  if (!body.game || typeof body.game !== 'string' || body.game.trim().length === 0) {
    return badRequest('game is required');
  }
  if (typeof body.ms !== 'number' || !Number.isInteger(body.ms) || body.ms <= 0) {
    return badRequest('ms must be a positive integer');
  }
  if (!body.playerName || typeof body.playerName !== 'string' || body.playerName.trim().length === 0) {
    return badRequest('playerName is required');
  }
  if (!body.playerId || typeof body.playerId !== 'string' || body.playerId.trim().length === 0) {
    return badRequest('playerId is required');
  }

  const id = generateId();
  const game = body.game.trim();
  const ms = body.ms;
  const playerName = body.playerName.trim();
  const playerId = body.playerId.trim();

  await env.DB.prepare(
    "INSERT INTO scores (id, game, ms, player_name, player_id, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))",
  ).bind(id, game, ms, playerName, playerId).run();

  if (admin) {
    await logAudit(env, {
      actor: admin,
      action: 'score.create',
      target_type: 'score',
      target_id: id,
      metadata: { game, ms, playerName },
    });
  }

  const { results } = await env.DB.prepare(
    'SELECT id, game, ms, player_name, player_id, created_at FROM scores WHERE id = ?',
  ).bind(id).run();

  return jsonResponse(results[0], 201);
}

export async function handleDeleteScore(
  env: Env,
  id: string,
  admin?: string,
): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT id, game, ms, player_name FROM scores WHERE id = ?',
  ).bind(id).run();
  if (!results[0]) return notFound('Score not found');

  await env.DB.prepare('DELETE FROM scores WHERE id = ?').bind(id).run();

  if (admin) {
    await logAudit(env, {
      actor: admin,
      action: 'score.delete',
      target_type: 'score',
      target_id: id,
      metadata: { deleted: results[0] },
    });
  }

  return jsonResponse({ deleted: true });
}
