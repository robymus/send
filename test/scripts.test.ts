import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { files as filesDb, tokens } from '../src/db.js';
import { blobDir, blobPath, ensureBlobDir } from '../src/lib/blobs.js';
import { cleanup } from '../src/scripts/cleanup.js';
import { seedAdmin } from '../src/scripts/seed-admin.js';
import { setupTestContext, truncateAll, type TestContext } from './helpers.js';

let ctx: TestContext;
let dataDir: string;

beforeAll(async () => {
  ctx = await setupTestContext();
});
afterAll(async () => {
  await ctx.destroy();
});
beforeEach(async () => {
  await truncateAll(ctx.pool);
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'send-cleanup-'));
  await ensureBlobDir(dataDir);
});

describe('seedAdmin', () => {
  it('creates a 40-hex-char admin token named Robert with no expiry', async () => {
    const token = await seedAdmin(ctx.pool);
    expect(token).toMatch(/^[0-9a-f]{40}$/);
    const row = await tokens.findByToken(ctx.pool, token);
    expect(row).toMatchObject({ name: 'Robert', is_admin: true, expires_at: null });
  });

  it('refuses to run twice', async () => {
    await seedAdmin(ctx.pool);
    await expect(seedAdmin(ctx.pool)).rejects.toThrow(/already exists/);
  });
});

describe('cleanup', () => {
  async function addFile(tokenId: string, ageMs = 0): Promise<string> {
    const id = randomUUID();
    await filesDb.create(ctx.pool, {
      id,
      tokenId,
      name: 'f.bin',
      sizeBytes: 3,
      uploadedByAdmin: false,
      uploaderName: 'X',
      countryCode: null,
    });
    await writeFile(blobPath(dataDir, id), 'abc');
    if (ageMs > 0) {
      const t = new Date(Date.now() - ageMs);
      await utimes(blobPath(dataDir, id), t, t);
    }
    return id;
  }

  it('deletes expired tokens with their file rows and blobs, keeps live ones and admin', async () => {
    await seedAdmin(ctx.pool);
    const expired = await tokens.create(ctx.pool, {
      token: 'expired-token-one',
      name: 'Old',
      expiresAt: new Date(Date.now() - 1000),
    });
    const live = await tokens.create(ctx.pool, {
      token: 'live-token-one',
      name: 'New',
      expiresAt: new Date(Date.now() + 86400_000),
    });
    await addFile(expired.id);
    await addFile(expired.id);
    const keptFile = await addFile(live.id);

    const result = await cleanup(ctx.pool, dataDir);
    expect(result).toMatchObject({ tokensDeleted: 1, blobsDeleted: 2 });

    const remainingTokens = await ctx.pool.query<{ token: string }>('SELECT token FROM tokens');
    expect(remainingTokens.rows.map((r) => r.token).sort()).toEqual([
      expect.stringMatching(/^[0-9a-f]{40}$/),
      'live-token-one',
    ]);
    expect(await readdir(blobDir(dataDir))).toEqual([keptFile]);
  });

  it('never deletes the admin token even without expiry', async () => {
    await seedAdmin(ctx.pool);
    const result = await cleanup(ctx.pool, dataDir);
    expect(result.tokensDeleted).toBe(0);
    expect(await tokens.adminExists(ctx.pool)).toBe(true);
  });

  it('sweeps orphaned blobs older than a day but keeps fresh ones', async () => {
    const oldOrphan = randomUUID();
    await writeFile(blobPath(dataDir, oldOrphan), 'orphan');
    const t = new Date(Date.now() - 2 * 86400_000);
    await utimes(blobPath(dataDir, oldOrphan), t, t);

    const freshOrphan = randomUUID();
    await writeFile(blobPath(dataDir, freshOrphan), 'fresh');
    await writeFile(path.join(blobDir(dataDir), 'not-a-uuid.txt'), 'ignore me');

    const result = await cleanup(ctx.pool, dataDir);
    expect(result.orphansDeleted).toBe(1);
    const left = await readdir(blobDir(dataDir));
    expect(left.sort()).toEqual([freshOrphan, 'not-a-uuid.txt'].sort());
  });
});
