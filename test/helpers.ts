import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { buildApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import { createPool, tokens, type TokenRow } from '../src/db.js';
import { ensureBlobDir } from '../src/lib/blobs.js';
import { runMigrations } from '../src/scripts/migrate.js';

export const TEST_DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://send:send@localhost:5433/send';

export interface TestContext {
  app: FastifyInstance;
  pool: pg.Pool;
  config: Config;
  geo: { country: string | null };
  destroy: () => Promise<void>;
}

/** Fresh schema + app on a temp data dir. Call once per test file. */
export async function setupTestContext(): Promise<TestContext> {
  const admin = createPool(TEST_DATABASE_URL);
  await admin.query('DROP SCHEMA IF EXISTS send CASCADE');
  await admin.end();
  await runMigrations(TEST_DATABASE_URL);

  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'send-test-'));
  await ensureBlobDir(dataDir);
  const config: Config = {
    databaseUrl: TEST_DATABASE_URL,
    sessionSecret: 'test-secret-test-secret-test-secret!',
    dataDir,
    port: 0,
    isProduction: false,
  };
  const pool = createPool(TEST_DATABASE_URL);
  const geo = { country: 'HU' as string | null };
  const app = await buildApp({
    config,
    pool,
    logger: false,
    geoLookup: () => Promise.resolve(geo.country),
  });

  return {
    app,
    pool,
    config,
    geo,
    destroy: async () => {
      await app.close();
      await pool.end();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

export async function truncateAll(pool: pg.Pool): Promise<void> {
  await pool.query('TRUNCATE files, tokens');
}

let ipCounter = 0;

/** Log in and return the session cookie value; unique client IP to dodge the rate limiter. */
export async function loginAs(app: FastifyInstance, token: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/login',
    headers: {
      'x-forwarded-for': `10.99.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`,
    },
    payload: { token },
  });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  const cookie = res.cookies.find((c) => c.name === 'send_session');
  if (!cookie) throw new Error('no session cookie set');
  return cookie.value;
}

export function sessionCookie(value: string): Record<string, string> {
  return { send_session: value };
}

export async function createAdmin(
  pool: pg.Pool,
  token = 'admintoken1234567890',
): Promise<TokenRow> {
  return tokens.create(pool, { token, name: 'Robert', isAdmin: true, expiresAt: null });
}

export async function createPartner(
  pool: pg.Pool,
  args: { token?: string; name?: string; limitBytes?: number; expiresAt?: Date | null } = {},
): Promise<TokenRow> {
  return tokens.create(pool, {
    token: args.token ?? 'happy-otter-dance',
    name: args.name ?? 'Alice',
    limitBytes: args.limitBytes,
    expiresAt: args.expiresAt === undefined ? new Date(Date.now() + 7 * 86400_000) : args.expiresAt,
  });
}

/** Hand-rolled multipart/form-data body for app.inject uploads. */
export function multipartUpload(
  filename: string,
  content: Buffer | string,
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----sendTestBoundary1234567890';
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, Buffer.from(content), tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}
