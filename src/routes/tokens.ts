import type { FastifyInstance } from 'fastify';
import { requireAdmin, requireTokenAccess } from '../auth.js';
import { files, tokens, type FileRow, type TokenRow } from '../db.js';
import { generateWordToken } from '../lib/wordlist.js';

export const MAX_LIMIT_BYTES = 1024 ** 3; // 1 GiB per-token cap (shared disk pool is small)
const TOKEN_RE = /^[a-z0-9-]{6,64}$/;
const UNIQUE_VIOLATION = '23505';

function tokenJson(row: TokenRow) {
  return {
    id: row.id,
    token: row.token,
    name: row.name,
    isAdmin: row.is_admin,
    limitBytes: row.limit_bytes,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

export function fileJson(row: FileRow) {
  return {
    id: row.id,
    name: row.name,
    sizeBytes: row.size_bytes,
    uploadedByAdmin: row.uploaded_by_admin,
    uploaderName: row.uploader_name,
    countryCode: row.country_code,
    uploadedAt: row.uploaded_at,
  };
}

function ttlToDate(ttlDays: number): Date {
  return new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
}

export function tokenRoutes(app: FastifyInstance): void {
  app.get('/api/generate-token', { preHandler: requireAdmin }, async (_request, reply) => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = generateWordToken();
      if (!(await tokens.findByToken(app.db, candidate))) return { token: candidate };
    }
    return reply.code(500).send({ error: 'Could not generate a unique token' });
  });

  app.get('/api/tokens', { preHandler: requireAdmin }, async () => {
    const rows = await tokens.list(app.db);
    return rows.map((row) => ({
      ...tokenJson(row),
      usedBytes: row.used_bytes,
      fileCount: row.file_count,
    }));
  });

  app.post<{ Body: { token?: string; name: string; ttlDays?: number; limitBytes?: number } }>(
    '/api/tokens',
    {
      preHandler: requireAdmin,
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          properties: {
            token: { type: 'string', minLength: 1, maxLength: 200 },
            name: { type: 'string', minLength: 1, maxLength: 100 },
            ttlDays: { type: 'integer', minimum: 1, maximum: 3650 },
            limitBytes: { type: 'integer', minimum: 1, maximum: MAX_LIMIT_BYTES },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { name, ttlDays = 7, limitBytes } = request.body;
      const expiresAt = ttlToDate(ttlDays);

      let manual: string | null = null;
      if (request.body.token !== undefined) {
        manual = request.body.token.trim().toLowerCase();
        if (!TOKEN_RE.test(manual)) {
          return reply.code(400).send({ error: 'Token must be 6-64 chars of a-z, 0-9 and dashes' });
        }
      }

      for (let attempt = 0; attempt < 10; attempt++) {
        const candidate = manual ?? generateWordToken();
        try {
          const row = await tokens.create(app.db, {
            token: candidate,
            name: name.trim(),
            limitBytes,
            expiresAt,
          });
          return reply.code(201).send(tokenJson(row));
        } catch (err) {
          if ((err as { code?: string }).code !== UNIQUE_VIOLATION) throw err;
          if (manual) return reply.code(409).send({ error: 'This token already exists' });
        }
      }
      return reply.code(500).send({ error: 'Could not generate a unique token' });
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/tokens/:id',
    {
      preHandler: requireTokenAccess,
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      const row = await tokens.findById(app.db, request.params.id);
      if (!row) return reply.code(404).send({ error: 'Token not found' });
      const fileRows = await files.listByToken(app.db, row.id);
      const usedBytes = fileRows.reduce((sum, f) => sum + f.size_bytes, 0);
      return {
        ...tokenJson(row),
        usedBytes,
        files: fileRows.map(fileJson),
      };
    },
  );

  app.patch<{ Params: { id: string }; Body: { ttlDays?: number; limitBytes?: number } }>(
    '/api/tokens/:id',
    {
      preHandler: requireAdmin,
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          properties: {
            ttlDays: { type: 'integer', minimum: 1, maximum: 3650 },
            limitBytes: { type: 'integer', minimum: 1, maximum: MAX_LIMIT_BYTES },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const row = await tokens.findById(app.db, request.params.id);
      if (!row) return reply.code(404).send({ error: 'Token not found' });
      if (row.is_admin) return reply.code(400).send({ error: 'The admin token cannot be edited' });
      const { ttlDays, limitBytes } = request.body;
      if (ttlDays === undefined && limitBytes === undefined) {
        return reply.code(400).send({ error: 'Nothing to update' });
      }
      const updated = await tokens.update(app.db, row.id, {
        expiresAt: ttlDays !== undefined ? ttlToDate(ttlDays) : undefined,
        limitBytes,
      });
      return tokenJson(updated!);
    },
  );
}
