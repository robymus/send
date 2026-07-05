import { readdir, rm } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { blobDir, ensureBlobDir } from '../src/lib/blobs.js';
import {
  createAdmin,
  createPartner,
  loginAs,
  multipartUpload,
  sessionCookie,
  setupTestContext,
  truncateAll,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;
let adminCookie: string;
let partnerCookie: string;
let partnerId: string;

beforeAll(async () => {
  ctx = await setupTestContext();
});
afterAll(async () => {
  await ctx.destroy();
});
beforeEach(async () => {
  await truncateAll(ctx.pool);
  await rm(blobDir(ctx.config.dataDir), { recursive: true, force: true });
  await ensureBlobDir(ctx.config.dataDir);
  ctx.geo.country = 'HU';
  const admin = await createAdmin(ctx.pool);
  const partner = await createPartner(ctx.pool, { limitBytes: 1000 });
  partnerId = partner.id;
  adminCookie = await loginAs(ctx.app, admin.token);
  partnerCookie = await loginAs(ctx.app, partner.token);
});

async function upload(cookie: string, filename: string, content: Buffer | string) {
  const { payload, headers } = multipartUpload(filename, content);
  return ctx.app.inject({
    method: 'POST',
    url: `/api/tokens/${partnerId}/files`,
    cookies: sessionCookie(cookie),
    headers,
    payload,
  });
}

describe('upload', () => {
  it('partner upload stores blob + row with uploader metadata', async () => {
    const res = await upload(partnerCookie, 'hello.txt', 'hello world');
    expect(res.statusCode).toBe(201);
    const body = res.json<Record<string, unknown>>();
    expect(body).toMatchObject({
      name: 'hello.txt',
      sizeBytes: 11,
      uploadedByAdmin: false,
      uploaderName: 'Alice',
      countryCode: 'HU',
    });
    const blobs = await readdir(blobDir(ctx.config.dataDir));
    expect(blobs).toContain(body.id);
  });

  it('admin upload on the same token is flagged uploaded_by_admin', async () => {
    const res = await upload(adminCookie, 'from-robert.bin', 'x');
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ uploadedByAdmin: true, uploaderName: 'Robert' });
  });

  it('geoip failure just omits the country', async () => {
    ctx.geo.country = null;
    const res = await upload(partnerCookie, 'noflag.txt', 'x');
    expect(res.statusCode).toBe(201);
    expect(res.json<{ countryCode: string | null }>().countryCode).toBeNull();
  });

  it('rejects when the total limit is already used up', async () => {
    await upload(partnerCookie, 'big.bin', Buffer.alloc(1000));
    const res = await upload(partnerCookie, 'more.bin', 'x');
    expect(res.statusCode).toBe(413);
  });

  it('rejects an over-budget upload via content-length pre-check', async () => {
    const res = await upload(partnerCookie, 'huge.bin', Buffer.alloc(200_000));
    expect(res.statusCode).toBe(413);
  });

  it('truncates and rejects when the stream exceeds the remaining budget, leaving no blob or row', async () => {
    // 600 fits, then another 600 exceeds the 1000 budget mid-stream (content-length
    // slack lets it past the pre-check).
    await upload(partnerCookie, 'first.bin', Buffer.alloc(600));
    const res = await upload(partnerCookie, 'second.bin', Buffer.alloc(600));
    expect(res.statusCode).toBe(413);
    const rows = await ctx.pool.query('SELECT name FROM files');
    expect(rows.rows).toHaveLength(1);
    const blobs = await readdir(blobDir(ctx.config.dataDir));
    expect(blobs).toHaveLength(1);
  });

  it("partner cannot upload to someone else's token", async () => {
    const other = await createPartner(ctx.pool, { token: 'other-token-here', name: 'Eve' });
    const { payload, headers } = multipartUpload('x.txt', 'x');
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/tokens/${other.id}/files`,
      cookies: sessionCookie(partnerCookie),
      headers,
      payload,
    });
    expect(res.statusCode).toBe(403);
  });

  it('requires a file field', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/tokens/${partnerId}/files`,
      cookies: sessionCookie(partnerCookie),
      headers: { 'content-type': 'multipart/form-data; boundary=empty123' },
      payload: `--empty123--\r\n`,
    });
    expect([400, 406]).toContain(res.statusCode);
  });
});

describe('download', () => {
  it('round-trips content with correct headers', async () => {
    const content = 'árvíztűrő tükörfúrógép';
    const up = await upload(partnerCookie, 'árvíz.txt', content);
    const fileId = up.json<{ id: string }>().id;
    const res = await ctx.app.inject({
      url: `/api/tokens/${partnerId}/files/${fileId}/download`,
      cookies: sessionCookie(adminCookie),
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(content);
    expect(res.headers['content-disposition']).toContain("filename*=UTF-8''%C3%A1rv%C3%ADz.txt");
    expect(Number(res.headers['content-length'])).toBe(Buffer.byteLength(content));
  });

  it('404s for a file on a different token', async () => {
    const up = await upload(partnerCookie, 'x.txt', 'x');
    const fileId = up.json<{ id: string }>().id;
    const other = await createPartner(ctx.pool, { token: 'other-token-two', name: 'Eve' });
    const res = await ctx.app.inject({
      url: `/api/tokens/${other.id}/files/${fileId}/download`,
      cookies: sessionCookie(adminCookie),
    });
    expect(res.statusCode).toBe(404);
  });

  it('requires login', async () => {
    const res = await ctx.app.inject({
      url: `/api/tokens/${partnerId}/files/${crypto.randomUUID()}/download`,
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('delete', () => {
  it('partner can delete their own file (blob removed too)', async () => {
    const up = await upload(partnerCookie, 'mine.txt', 'mine');
    const fileId = up.json<{ id: string }>().id;
    const res = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/tokens/${partnerId}/files/${fileId}`,
      cookies: sessionCookie(partnerCookie),
    });
    expect(res.statusCode).toBe(200);
    expect((await ctx.pool.query('SELECT 1 FROM files')).rows).toHaveLength(0);
    expect(await readdir(blobDir(ctx.config.dataDir))).toHaveLength(0);
  });

  it("partner cannot delete the admin's file", async () => {
    const up = await upload(adminCookie, 'roberts.txt', 'important');
    const fileId = up.json<{ id: string }>().id;
    const res = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/tokens/${partnerId}/files/${fileId}`,
      cookies: sessionCookie(partnerCookie),
    });
    expect(res.statusCode).toBe(403);
  });

  it("admin can delete the partner's file", async () => {
    const up = await upload(partnerCookie, 'partners.txt', 'x');
    const fileId = up.json<{ id: string }>().id;
    const res = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/tokens/${partnerId}/files/${fileId}`,
      cookies: sessionCookie(adminCookie),
    });
    expect(res.statusCode).toBe(200);
  });
});
