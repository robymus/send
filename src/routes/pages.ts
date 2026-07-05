import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

export async function pageRoutes(app: FastifyInstance): Promise<void> {
  await app.register(fastifyStatic, {
    root: fileURLToPath(new URL('../../public', import.meta.url)),
    index: false,
  });

  app.get('/', (_request, reply) => reply.sendFile('index.html'));
  app.get('/admin', (_request, reply) => reply.sendFile('admin.html'));
  app.get('/t/:id', (_request, reply) => reply.sendFile('token.html'));
}
