import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WORDS } from '../src/lib/words.js';
import {
  createAdmin,
  createPartner,
  loginAs,
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
  const admin = await createAdmin(ctx.pool);
  const partner = await createPartner(ctx.pool);
  partnerId = partner.id;
  adminCookie = await loginAs(ctx.app, admin.token);
  partnerCookie = await loginAs(ctx.app, partner.token);
});

describe('GET /api/generate-token', () => {
  it('returns 3 dash-joined wordlist words (admin only)', async () => {
    const res = await ctx.app.inject({
      url: '/api/generate-token',
      cookies: sessionCookie(adminCookie),
    });
    expect(res.statusCode).toBe(200);
    const parts = res.json<{ token: string }>().token.split('-');
    expect(parts).toHaveLength(3);
    for (const p of parts) expect(WORDS).toContain(p);
  });

  it('is forbidden for partners', async () => {
    const res = await ctx.app.inject({
      url: '/api/generate-token',
      cookies: sessionCookie(partnerCookie),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /api/tokens', () => {
  it('creates a token with defaults (7 day TTL, 100 MiB limit)', async () => {
    const before = Date.now();
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/tokens',
      cookies: sessionCookie(adminCookie),
      payload: { name: 'Bob' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ token: string; name: string; limitBytes: number; expiresAt: string }>();
    expect(body.name).toBe('Bob');
    expect(body.limitBytes).toBe(104857600);
    expect(body.token.split('-')).toHaveLength(3);
    const ttlMs = new Date(body.expiresAt).getTime() - before;
    expect(ttlMs).toBeGreaterThan(6.9 * 86400_000);
    expect(ttlMs).toBeLessThan(7.1 * 86400_000);
  });

  it('accepts a manual token, lowercased, with custom ttl and limit', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/tokens',
      cookies: sessionCookie(adminCookie),
      payload: { name: 'Carol', token: 'My-Custom-Token99', ttlDays: 1, limitBytes: 1000 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ token: string; limitBytes: number }>();
    expect(body.token).toBe('my-custom-token99');
    expect(body.limitBytes).toBe(1000);
  });

  it('rejects invalid manual tokens', async () => {
    for (const bad of ['short', 'has space in it', 'ütf-tökén-nono', 'x'.repeat(65)]) {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/tokens',
        cookies: sessionCookie(adminCookie),
        payload: { name: 'X', token: bad },
      });
      expect(res.statusCode, bad).toBe(400);
    }
  });

  it('rejects duplicate manual tokens with 409 (case-insensitively)', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/tokens',
      cookies: sessionCookie(adminCookie),
      payload: { name: 'X', token: 'HAPPY-OTTER-DANCE' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('is forbidden for partners', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/tokens',
      cookies: sessionCookie(partnerCookie),
      payload: { name: 'Eve' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /api/tokens', () => {
  it('lists all tokens with usage for admin', async () => {
    const res = await ctx.app.inject({ url: '/api/tokens', cookies: sessionCookie(adminCookie) });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ name: string; usedBytes: number; fileCount: number }[]>();
    expect(body).toHaveLength(2);
    expect(body.every((t) => t.usedBytes === 0 && t.fileCount === 0)).toBe(true);
  });

  it('is forbidden for partners', async () => {
    const res = await ctx.app.inject({ url: '/api/tokens', cookies: sessionCookie(partnerCookie) });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /api/tokens/:id', () => {
  it('admin can view any token', async () => {
    const res = await ctx.app.inject({
      url: `/api/tokens/${partnerId}`,
      cookies: sessionCookie(adminCookie),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: 'Alice', usedBytes: 0, files: [] });
  });

  it('partner can view their own token', async () => {
    const res = await ctx.app.inject({
      url: `/api/tokens/${partnerId}`,
      cookies: sessionCookie(partnerCookie),
    });
    expect(res.statusCode).toBe(200);
  });

  it("partner cannot view someone else's token", async () => {
    const other = await createPartner(ctx.pool, { token: 'other-partner-token', name: 'Eve' });
    const res = await ctx.app.inject({
      url: `/api/tokens/${other.id}`,
      cookies: sessionCookie(partnerCookie),
    });
    expect(res.statusCode).toBe(403);
  });

  it('requires login', async () => {
    const res = await ctx.app.inject({ url: `/api/tokens/${partnerId}` });
    expect(res.statusCode).toBe(401);
  });
});

describe('PATCH /api/tokens/:id', () => {
  it('updates the TTL as days from now', async () => {
    const before = Date.now();
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tokens/${partnerId}`,
      cookies: sessionCookie(adminCookie),
      payload: { ttlDays: 30 },
    });
    expect(res.statusCode).toBe(200);
    const expiresAt = new Date(res.json<{ expiresAt: string }>().expiresAt).getTime();
    expect(expiresAt - before).toBeGreaterThan(29.9 * 86400_000);
    expect(expiresAt - before).toBeLessThan(30.1 * 86400_000);
  });

  it('updates the size limit', async () => {
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tokens/${partnerId}`,
      cookies: sessionCookie(adminCookie),
      payload: { limitBytes: 5_000_000 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ limitBytes: number }>().limitBytes).toBe(5_000_000);
  });

  it('refuses to edit the admin token', async () => {
    const adminRow = await ctx.pool.query<{ id: string }>('SELECT id FROM tokens WHERE is_admin');
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tokens/${adminRow.rows[0]!.id}`,
      cookies: sessionCookie(adminCookie),
      payload: { ttlDays: 1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('is forbidden for partners (even their own token)', async () => {
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tokens/${partnerId}`,
      cookies: sessionCookie(partnerCookie),
      payload: { ttlDays: 3650 },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects an empty patch', async () => {
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tokens/${partnerId}`,
      cookies: sessionCookie(adminCookie),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});
