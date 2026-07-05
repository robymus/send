import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type pg from 'pg';
import { loadAuth } from './auth.js';
import type { Config } from './config.js';
import { lookupCountry } from './lib/geoip.js';
import { fileRoutes } from './routes/files.js';
import { loginRoutes } from './routes/login.js';
import { pageRoutes } from './routes/pages.js';
import { tokenRoutes } from './routes/tokens.js';

declare module 'fastify' {
  interface FastifyInstance {
    sendConfig: Config;
    geoLookup: (ip: string) => Promise<string | null>;
  }
}

export interface AppDeps {
  config: Config;
  pool: pg.Pool;
  geoLookup?: (ip: string) => Promise<string | null>;
  logger?: boolean;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = fastify({
    logger: deps.logger ?? true,
    trustProxy: true, // Caddy/nginx sit in front; X-Forwarded-For carries the client IP
    bodyLimit: 2 ** 31 - 1, // real per-token limits are enforced in the upload route
  });

  app.decorate('db', deps.pool);
  app.decorate('sendConfig', deps.config);
  app.decorate('geoLookup', deps.geoLookup ?? lookupCountry);
  app.decorateRequest('auth', null);

  await app.register(fastifyCookie, { secret: deps.config.sessionSecret });
  await app.register(fastifyMultipart, {
    limits: { files: 1, fileSize: 2 ** 31 - 1 },
    throwFileSizeLimit: false, // we detect truncation via file.truncated instead
  });
  app.addHook('onRequest', loadAuth);

  app.setErrorHandler((err: FastifyError, request, reply) => {
    if (err.validation) {
      return reply.code(400).send({ error: err.message });
    }
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    if (status >= 500) request.log.error(err);
    return reply.code(status).send({ error: status >= 500 ? 'Internal error' : err.message });
  });

  app.get('/healthz', async () => {
    await deps.pool.query('SELECT 1');
    return { ok: true };
  });

  loginRoutes(app);
  tokenRoutes(app);
  fileRoutes(app);
  await pageRoutes(app);

  return app;
}
