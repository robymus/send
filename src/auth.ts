import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { tokens, type TokenRow } from './db.js';

export const SESSION_COOKIE = 'send_session';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface AuthContext {
  token: TokenRow;
  isAdmin: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
  interface FastifyInstance {
    db: pg.Pool;
  }
}

export function isExpired(token: TokenRow, now = new Date()): boolean {
  return token.expires_at !== null && token.expires_at < now;
}

/** Global onRequest hook: resolve the session cookie to a live token row (or null). */
export async function loadAuth(request: FastifyRequest): Promise<void> {
  request.auth = null;
  const raw = request.cookies[SESSION_COOKIE];
  if (!raw) return;
  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value || !UUID_RE.test(unsigned.value)) return;
  const row = await tokens.findById(request.server.db, unsigned.value);
  if (!row || isExpired(row)) return;
  request.auth = { token: row, isAdmin: row.is_admin };
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.auth) {
    await reply.code(401).send({ error: 'Not logged in' });
  }
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.auth) {
    await reply.code(401).send({ error: 'Not logged in' });
  } else if (!request.auth.isAdmin) {
    await reply.code(403).send({ error: 'Admin only' });
  }
}

/**
 * Guard for token-scoped routes (/api/tokens/:id/...): admin may act on any token,
 * a partner only on their own.
 */
export async function requireTokenAccess(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  if (!request.auth) {
    await reply.code(401).send({ error: 'Not logged in' });
    return;
  }
  if (!request.auth.isAdmin && request.auth.token.id !== request.params.id) {
    await reply.code(403).send({ error: 'Forbidden' });
  }
}
