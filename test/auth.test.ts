import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

beforeAll(async () => {
  ctx = await setupTestContext();
});
afterAll(async () => {
  await ctx.destroy();
});
beforeEach(async () => {
  await truncateAll(ctx.pool);
});

describe('login', () => {
  it('logs in with a valid token and sets a session cookie', async () => {
    await createPartner(ctx.pool, { token: 'happy-otter-dance', name: 'Alice' });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { token: 'happy-otter-dance' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: 'Alice', isAdmin: false });
    const cookie = res.cookies.find((c) => c.name === 'send_session');
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
  });

  it('is case-insensitive and trims whitespace', async () => {
    await createPartner(ctx.pool, { token: 'happy-otter-dance' });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { token: '  HAPPY-Otter-DANCE ' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects unknown tokens with 401', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { token: 'nope-nope-nope' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects expired tokens with 401', async () => {
    await createPartner(ctx.pool, {
      token: 'old-stale-token',
      expiresAt: new Date(Date.now() - 1000),
    });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { token: 'old-stale-token' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rate limits repeated attempts from one IP with 429', async () => {
    const headers = { 'x-forwarded-for': '203.0.113.7' };
    let last = 0;
    for (let i = 0; i < 11; i++) {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/login',
        headers,
        payload: { token: 'wrong' },
      });
      last = res.statusCode;
    }
    expect(last).toBe(429);
  });
});

describe('session', () => {
  it('GET /api/me returns the session identity', async () => {
    const admin = await createAdmin(ctx.pool);
    const cookie = await loginAs(ctx.app, admin.token);
    const res = await ctx.app.inject({ url: '/api/me', cookies: sessionCookie(cookie) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ tokenId: admin.id, name: 'Robert', isAdmin: true });
  });

  it('GET /api/me without a session returns 401', async () => {
    const res = await ctx.app.inject({ url: '/api/me' });
    expect(res.statusCode).toBe(401);
  });

  it('a forged (unsigned) cookie is rejected', async () => {
    const admin = await createAdmin(ctx.pool);
    const res = await ctx.app.inject({
      url: '/api/me',
      cookies: { send_session: admin.id },
    });
    expect(res.statusCode).toBe(401);
  });

  it('the session dies when the token expires', async () => {
    const partner = await createPartner(ctx.pool);
    const cookie = await loginAs(ctx.app, partner.token);
    await ctx.pool.query(`UPDATE tokens SET expires_at = now() - interval '1 minute'`);
    const res = await ctx.app.inject({ url: '/api/me', cookies: sessionCookie(cookie) });
    expect(res.statusCode).toBe(401);
  });

  it('logout clears the cookie', async () => {
    const partner = await createPartner(ctx.pool);
    const cookie = await loginAs(ctx.app, partner.token);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/logout',
      cookies: sessionCookie(cookie),
    });
    expect(res.statusCode).toBe(200);
    const cleared = res.cookies.find((c) => c.name === 'send_session');
    expect(cleared?.value).toBe('');
  });
});

describe('healthz', () => {
  it('returns ok', async () => {
    const res = await ctx.app.inject({ url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
