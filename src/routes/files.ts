import { createReadStream, createWriteStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { stat, unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import { requireTokenAccess } from '../auth.js';
import { files, tokens } from '../db.js';
import { blobPath } from '../lib/blobs.js';
import { fileJson } from './tokens.js';

// Multipart framing overhead allowed on top of the remaining byte budget before we
// reject on Content-Length alone; the stream cap below is the authoritative check.
const CONTENT_LENGTH_SLACK = 16 * 1024;

const uuidParams = {
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      fileId: { type: 'string', format: 'uuid' },
    },
  },
};

/** RFC 6266/5987 Content-Disposition for arbitrary (possibly non-ASCII) filenames. */
export function contentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function fileRoutes(app: FastifyInstance): void {
  app.post<{ Params: { id: string } }>(
    '/api/tokens/:id/files',
    { preHandler: requireTokenAccess, schema: uuidParams },
    async (request, reply) => {
      const token = await tokens.findById(app.db, request.params.id);
      if (!token) return reply.code(404).send({ error: 'Token not found' });

      const used = await files.usedBytes(app.db, token.id);
      const remaining = token.limit_bytes - used;
      const overLimit = () =>
        reply.code(413).send({
          error: `Size limit reached: this token can store ${token.limit_bytes} bytes in total`,
        });
      if (remaining <= 0) return overLimit();

      const contentLength = Number(request.headers['content-length']);
      if (contentLength && contentLength > remaining + CONTENT_LENGTH_SLACK) return overLimit();

      const part = await request.file({ limits: { fileSize: remaining } });
      if (!part) return reply.code(400).send({ error: 'A "file" field is required' });

      const fileId = randomUUID();
      const dest = blobPath(app.sendConfig.dataDir, fileId);
      try {
        await pipeline(part.file, createWriteStream(dest, { flags: 'wx' }));
        if (part.file.truncated) {
          await unlink(dest);
          return overLimit();
        }
      } catch (err) {
        await unlink(dest).catch(() => {});
        throw err;
      }

      const auth = request.auth!;
      const countryCode = await app.geoLookup(request.ip);
      const size = (await stat(dest)).size;
      const row = await files.create(app.db, {
        id: fileId,
        tokenId: token.id,
        name: (part.filename || 'unnamed').slice(0, 255),
        sizeBytes: size,
        uploadedByAdmin: auth.isAdmin,
        uploaderName: auth.token.name,
        countryCode,
      });
      return reply.code(201).send(fileJson(row));
    },
  );

  app.get<{ Params: { id: string; fileId: string } }>(
    '/api/tokens/:id/files/:fileId/download',
    { preHandler: requireTokenAccess, schema: uuidParams },
    async (request, reply) => {
      const row = await files.findById(app.db, request.params.id, request.params.fileId);
      if (!row) return reply.code(404).send({ error: 'File not found' });
      return reply
        .header('content-type', 'application/octet-stream')
        .header('content-length', row.size_bytes)
        .header('content-disposition', contentDisposition(row.name))
        .send(createReadStream(blobPath(app.sendConfig.dataDir, row.id)));
    },
  );

  app.delete<{ Params: { id: string; fileId: string } }>(
    '/api/tokens/:id/files/:fileId',
    { preHandler: requireTokenAccess, schema: uuidParams },
    async (request, reply) => {
      const row = await files.findById(app.db, request.params.id, request.params.fileId);
      if (!row) return reply.code(404).send({ error: 'File not found' });
      const auth = request.auth!;
      if (!auth.isAdmin && row.uploaded_by_admin) {
        return reply.code(403).send({ error: 'You can only delete files you uploaded' });
      }
      await files.deleteById(app.db, row.id);
      await unlink(blobPath(app.sendConfig.dataDir, row.id)).catch(() => {});
      return { ok: true };
    },
  );
}
