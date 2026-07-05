import type { FastifyInstance } from 'fastify';
import { isExpired, requireAuth, SESSION_COOKIE } from '../auth.js';
import { tokens } from '../db.js';
import { RateLimiter } from '../lib/rateLimit.js';

const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;

export function loginRoutes(app: FastifyInstance): void {
  const limiter = new RateLimiter(10, 60_000);

  app.post<{ Body: { token: string } }>(
    '/api/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['token'],
          properties: { token: { type: 'string', minLength: 1, maxLength: 200 } },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      if (!limiter.allow(request.ip)) {
        return reply.code(429).send({ error: 'Too many attempts, try again in a minute' });
      }
      const normalized = request.body.token.trim().toLowerCase();
      const row = await tokens.findByToken(app.db, normalized);
      if (!row || isExpired(row)) {
        return reply.code(401).send({ error: 'Invalid token' });
      }
      return reply
        .setCookie(SESSION_COOKIE, row.id, {
          signed: true,
          httpOnly: true,
          sameSite: 'lax',
          secure: app.sendConfig.isProduction,
          path: '/',
          maxAge: SESSION_MAX_AGE_S,
        })
        .send({ tokenId: row.id, name: row.name, isAdmin: row.is_admin });
    },
  );

  app.post('/api/logout', async (_request, reply) => {
    return reply.clearCookie(SESSION_COOKIE, { path: '/' }).send({ ok: true });
  });

  app.get('/api/me', { preHandler: requireAuth }, (request) => {
    const auth = request.auth!;
    return { tokenId: auth.token.id, name: auth.token.name, isAdmin: auth.isAdmin };
  });
}
