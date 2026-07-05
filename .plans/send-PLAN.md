# send — minimal token-based file transfer app — implementation plan

Spec: [SEND.md](../SEND.md). Greenfield. Deploy target: **https://send.apps.p97.dev** on the
core.p97.dev dokku (app name `send`). Committing straight to `main` is authorized for this session.

## 1. Approach overview

A single small Node.js/TypeScript service: Fastify serves a JSON API **and** the static
frontend (plain HTML/CSS/vanilla JS — no frontend framework, no bundler). Metadata lives in
the shared dokku Postgres (schema `send`); file blobs live on a dokku storage mount at
`/data/files/<uuid>`. Auth is one token per person, exchanged for an encrypted session cookie.
A daily dokku cron job deletes expired tokens and their files.

Why this shape:

- **One process, no build pipeline for the UI** — the UI is two screens plus a login page;
  vanilla JS with `fetch` keeps the whole thing reviewable and testable.
- **TypeScript + Fastify** — typed request/reply schemas, first-class multipart streaming,
  trivially testable with `app.inject()` (no network needed in unit tests).
- **Postgres for metadata, disk for blobs** — blobs in the DB would bloat the shared service;
  disk + storage mount survives redeploys.

### Tech stack

| Concern      | Choice                                                                                                   |
| ------------ | -------------------------------------------------------------------------------------------------------- |
| Runtime      | Node 22, TypeScript (strict), ESM                                                                        |
| HTTP         | Fastify 5, `@fastify/static`, `@fastify/multipart`, `@fastify/secure-session`                            |
| DB           | `pg` pool against shared Postgres, schema `send` via `search_path`; migrations with `node-pg-migrate`    |
| GeoIP        | best-effort lookup at upload time via `https://ipwho.is/<ip>` (1s timeout, failure → no flag)            |
| Tests        | Vitest + `app.inject()`, integration tests against a real Postgres (local docker / CI service container) |
| Lint         | ESLint 9 flat config + Prettier; `tsc --noEmit` typecheck                                                |
| CI           | GitHub Actions on `robymus/send`: lint + typecheck + tests (Postgres 17 service)                         |
| Build/deploy | Dockerfile (multi-stage, `node:22-alpine`), dokku push model, cron via `app.json`                        |

Why an external GeoIP API instead of `geoip-lite`: geoip-lite keeps ~100 MB of data in RAM
permanently; uploads are rare events, so one HTTPS lookup per upload (best-effort, non-blocking
for correctness) is the better trade on a small VPS. If `ipwho.is` dies, the flag is simply
omitted — it is a "for fun" feature per spec.

## 2. Data model

Migration `0001` (via `node-pg-migrate`, run automatically at container start before the
server boots):

```sql
CREATE SCHEMA IF NOT EXISTS send;   -- shared-Postgres convention: one schema per app

CREATE TABLE tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token       text NOT NULL UNIQUE,          -- always stored lowercase (case-insensitive login)
  name        text NOT NULL,                 -- recipient display name; admin row = 'Robert'
  is_admin    boolean NOT NULL DEFAULT false,
  limit_bytes bigint  NOT NULL DEFAULT 104857600,   -- 100 MiB default, per-token total
  expires_at  timestamptz,                   -- NULL = never (admin token)
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE files (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),  -- also the on-disk filename
  token_id          uuid NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
  name              text NOT NULL,           -- original filename (display + download header)
  size_bytes        bigint NOT NULL,
  uploaded_by_admin boolean NOT NULL,        -- drives partner delete permission
  uploader_name     text NOT NULL,           -- 'Robert' or the token's name (denormalized on purpose)
  country_code      text,                    -- ISO 3166-1 alpha-2, nullable
  uploaded_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX files_token_id_uploaded_at_idx ON files (token_id, uploaded_at);
```

The pool pins the schema so app code never qualifies names:

```ts
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  options: '-c search_path=send',
});
```

## 3. Auth & sessions

- Login normalizes: `token.trim().toLowerCase()` — tokens are stored lowercase, so lookup is a
  plain unique-index hit. Expired tokens are rejected at login _and_ on every request.
- `@fastify/secure-session` (stateless encrypted cookie, `httpOnly`, `sameSite=lax`,
  `secure` in production; key from `SESSION_SECRET` env). The cookie stores only `tokenId`; every
  request re-loads the token row, so deletion/expiry takes effect immediately.
- A `requireAuth` hook decorates `request.auth = { token: TokenRow, isAdmin: boolean }`; a
  second `requireAdmin` guard wraps admin routes. Authorization rule for token-scoped routes:
  admin may act on any token, a partner only on their own (`params.id === auth.token.id`).

```ts
// login handler core
const row = await tokens.findByToken(body.token.trim().toLowerCase());
if (!row || (row.expires_at && row.expires_at < new Date())) {
  return reply.code(401).send({ error: 'Invalid token' });
}
request.session.set('tokenId', row.id);
return { name: row.name, isAdmin: row.is_admin, tokenId: row.id };
```

## 4. API surface

All JSON under `/api`, session-cookie auth unless noted.

| Method & path                                 | Who                                          | Purpose                                                                                           |
| --------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `POST /api/login`                             | public                                       | `{token}` → session cookie + `{name, isAdmin, tokenId}`                                           |
| `POST /api/logout`                            | any                                          | clear session                                                                                     |
| `GET  /api/me`                                | any                                          | session info for page-load guard                                                                  |
| `GET  /api/generate-token`                    | admin                                        | 3 random dash-joined words from embedded EFF wordlist, retried until unique                       |
| `GET  /api/tokens`                            | admin                                        | list all tokens (name, token, expiry, usage/limit, file count)                                    |
| `POST /api/tokens`                            | admin                                        | `{token?, name, ttlDays=7, limitBytes?}` → create (token lowercased; validated `[a-z0-9-]{6,64}`) |
| `GET  /api/tokens/:id`                        | admin or owner                               | token detail + files (time-ordered, with uploader name, size, flag)                               |
| `PATCH /api/tokens/:id`                       | admin                                        | `{ttlDays?}` → `expires_at = now() + N days`; `{limitBytes?}`                                     |
| `POST /api/tokens/:id/files`                  | admin or owner                               | multipart upload (see §5)                                                                         |
| `GET  /api/tokens/:id/files/:fileId/download` | admin or owner                               | stream from disk, `Content-Disposition: attachment` (RFC 5987-encoded original name)              |
| `DELETE /api/tokens/:id/files/:fileId`        | admin, or owner if `uploaded_by_admin=false` | delete row + unlink blob                                                                          |

Pages (same server, `@fastify/static` + tiny route handlers): `/` login, `/admin` dashboard
(create form + token list), `/t/:id` token/files page (shared by admin and partner; partner is
redirected here after login and sees "Hello {name}" without the TTL/limit editors).

## 5. Upload path & the per-token size cap

The limit is on the **total stored bytes per token** (admin + partner files combined),
default 100 MiB, admin-editable per token. Enforced twice:

1. **Pre-check**: `SELECT COALESCE(SUM(size_bytes),0) FROM files WHERE token_id=$1` →
   `remaining = limit_bytes - used`; reject immediately with `413` and a human message if the
   incoming `content-length` already exceeds it.
2. **Stream cap**: the multipart file stream is piped to `/data/files/<uuid>` with
   `@fastify/multipart`'s `limits.fileSize = remaining`, so a lying/absent content-length still
   cannot overshoot; on truncation the partial blob is unlinked and `413` returned.

```ts
const mp = await request.file({ limits: { fileSize: remaining } });
const blobPath = path.join(config.dataDir, 'files', fileId);
await pipeline(mp.file, createWriteStream(blobPath, { flags: 'wx' }));
if (mp.file.truncated) { await unlink(blobPath); return reply.code(413).send(...); }
// then: geoip best-effort, INSERT row (size = bytes actually written)
```

Uploader identity: `uploaded_by_admin = auth.isAdmin`, `uploader_name = auth.token.name`.
Client IP: `trustProxy: true` (Caddy → dokku nginx set `X-Forwarded-For`); flag emoji is
derived client-side from `country_code` via regional-indicator codepoints (no image assets).

## 6. Token generation

- **Admin token** (seed, §9): `crypto.randomBytes(20).toString('hex')` → 40 lowercase hex
  chars, 160 bits. Name `Robert`, `is_admin=true`, `expires_at=NULL`, never listed for deletion
  by cleanup.
- **Partner autogenerate**: 3 words from the embedded EFF short wordlist (1,296 words, ~7 KB
  TS module) joined with dashes, e.g. `acorn-mellow-drift` (~31 bits — fine for short-lived,
  rate-limited tokens); regenerate on unique-constraint collision. Manual entry allowed,
  lowercased + validated.
- Light brute-force protection: in-memory fixed-window rate limit on `/api/login`
  (e.g. 10 attempts/min/IP) — cheap and adequate for this threat model.

## 7. TTL cleanup (daily cron)

`src/scripts/cleanup.ts`, wired as a dokku cron entry in `app.json` (runs in a one-off
container from the same image, so it sees `/data` and `DATABASE_URL`):

```json
{ "cron": [{ "command": "node dist/scripts/cleanup.js", "schedule": "@daily" }] }
```

```ts
const expired = await pool.query(
  `SELECT t.id, array_remove(array_agg(f.id), NULL) AS file_ids
     FROM tokens t LEFT JOIN files f ON f.token_id = t.id
    WHERE NOT t.is_admin AND t.expires_at < now()
    GROUP BY t.id`,
);
for (const row of expired.rows) {
  await pool.query('DELETE FROM tokens WHERE id=$1', [row.id]); // cascades to files rows
  for (const fid of row.file_ids) await unlink(blobPath(fid)).catch(() => {});
}
```

Plus a defensive orphan sweep (blobs on disk with no DB row, older than 1 day) so a crash
mid-delete can't leak disk forever.

## 8. UI & the squirrel

Three static pages sharing one stylesheet and a hand-drawn **SVG squirrel holding an
envelope** (I'll author the SVG directly — rounded, cartoon style, warm autumn palette:
chestnut `#b5651d`, cream, leaf-green accent). The logo is the hero of the login page
(~40% of viewport) and a smaller fixed mascot on the other pages, per spec.

- **Login `/`**: logo + one input + button. On 401 the squirrel does a small CSS "head shake".
- **Admin `/admin`**: create-token card (token input + "🎲 generate" button calling
  `/api/generate-token`, name, TTL days default 7, limit MB default 100) → on create,
  navigate to `/t/:id`. Below: token table (name, token, expires-in, used/limit, files) —
  rows link to `/t/:id`.
- **Token page `/t/:id`** (both roles): header "Hello {name}" for partners / token summary +
  TTL ("set days from now") and limit editors for admin. File list in upload-time order:
  name, human size, uploader name, flag emoji, upload time; download link and delete button
  (delete hidden for partner on admin-uploaded files; server enforces regardless). Upload via
  file input + drag-and-drop onto the squirrel, XHR for a progress bar, usage meter
  ("34.2 MB of 100 MB used").

No framework: each page is `<page>.html` + `<page>.js` (ES modules) + `app.css`. Client JS is
linted by the same ESLint config.

## 9. Repo layout, quality gates, CI

```
send/
├─ SEND.md  UNLICENSE  README.md
├─ package.json  tsconfig.json  eslint.config.js  .prettierrc  vitest.config.ts
├─ Dockerfile  app.json  .dockerignore
├─ .github/workflows/ci.yml
├─ migrations/0001_init.js
├─ public/            # index.html, admin.html, token.html, app.css, js/, squirrel.svg
├─ src/
│  ├─ server.ts       # entrypoint: run migrations, build app, listen
│  ├─ app.ts          # buildApp(): plugins, routes — the unit under test
│  ├─ config.ts  db.ts  auth.ts
│  ├─ routes/  (login.ts, tokens.ts, files.ts, pages.ts)
│  ├─ lib/     (wordlist.ts, geoip.ts, humanSize.ts, flags.ts)
│  └─ scripts/ (cleanup.ts, seed-admin.ts)
└─ test/              # unit + API integration tests
```

- **Tests** (Vitest): pure-unit (token normalization, wordlist, flag emoji, size formatting,
  limit math) and API integration via `buildApp()` + `app.inject()` against a real Postgres —
  login (incl. case-insensitivity, expired token), authz matrix (partner vs admin on foreign
  tokens, partner deleting admin files → 403), upload limit enforcement (pre-check + stream
  truncation), TTL update, cleanup script behavior. Local dev DB via `docker compose up db`.
- **CI** (`.github/workflows/ci.yml`): on push/PR — `npm ci`, `eslint .`, `tsc --noEmit`,
  `vitest run` with a `postgres:17` service container. Repo `robymus/send` (origin already
  configured); commits as `robymus-agent <robymus-agent@users.noreply.github.com>`.
- **Seed script** `seed-admin.ts`: generates the admin token **itself**, inserts
  (`Robert`, admin, no expiry), prints it exactly once to stdout, and refuses to run if an
  admin row already exists (so it can't silently rotate). Run once via `dokku run` (§10) —
  this avoids the secret ever appearing in a shell command line or env var; I'll capture the
  output and post the token in chat as requested.

## 10. Deployment (dokku, push model)

```bash
DK="ssh -i ~/.ssh/p97_core_claude -4 -p 42022 -o IdentitiesOnly=yes -o BatchMode=yes dokku@core.p97.dev"

$DK apps:create send
$DK postgres:link shared send                    # injects DATABASE_URL (schema 'send' created by migration)
$DK storage:ensure-directory send
$DK storage:mount send /var/lib/dokku/data/storage/send:/data
$DK config:set send NODE_ENV=production DATA_DIR=/data SESSION_SECRET=<openssl rand -hex 32>

git remote add dokku ssh://dokku@core.p97.dev:42022/send
GIT_SSH_COMMAND="ssh -i ~/.ssh/p97_core_claude -4 -o IdentitiesOnly=yes" git push dokku main

$DK run send node dist/scripts/seed-admin.js     # → prints admin token; posted in chat, then verify login
curl -s https://send.apps.p97.dev/healthz        # smoke check (route returns 200 + DB ping)
```

Dockerfile: multi-stage (`npm ci` + `tsc` → runtime stage with prod deps, `public/`,
`migrations/`, `EXPOSE 3000`); container start = `node dist/server.js` which runs
`node-pg-migrate up` first. TLS is Caddy's job — the app serves plain HTTP; **no dokku
letsencrypt**. `trustProxy: true` for real client IPs. Uploads up to the token limit are fine
through Caddy/nginx defaults, but I'll verify a ~100 MB upload end-to-end and bump proxy body
limits if needed.

## 11. Considerations & trade-offs

- **Token as sole credential**: by design (spec). Mitigations: rate-limited login, short TTLs,
  per-token size caps, admin token is 160-bit random. Word-tokens are weak but expire.
- **Session cookie vs per-request token**: cookie keeps download links plain `<a href>` (no JS
  auth headers) and survives page reloads; stateless so no session table.
- **Denormalized `uploader_name`**: file listings never join, and history stays correct even
  if a token is renamed later. Accepted redundancy.
- **External GeoIP**: adds a network dependency at upload time — bounded by a 1 s timeout and
  total failure only costs the flag. Chosen over ~100 MB resident RAM for geoip-lite.
- **Single web process, files on one mount**: fine for a personal transfer tool on the shared
  30 GiB btrfs pool; the per-token cap plus TTL cleanup bounds disk usage. If someone ever
  needs multi-GB transfers, move blobs to a dedicated volume (noted in dokku guide).
- **Cleanup timing**: expired tokens can't log in even before the daily cron runs (checked at
  auth), so the cron is purely garbage collection.

## 12. Implementation order

1. Scaffold: package.json, tsconfig, ESLint/Prettier, Vitest, docker-compose (dev DB), CI workflow.
2. DB layer + migration + config; seed-admin & cleanup scripts.
3. Auth (login/session/guards) + token CRUD API, with tests alongside.
4. File upload/download/delete + limit enforcement + geoip, with tests.
5. Frontend: squirrel SVG, three pages, styling, drag-and-drop + progress.
6. Dockerfile + app.json cron; local end-to-end run (incl. `/verify`-style pass through the real flows).
7. Push to GitHub `main` (CI green), create dokku app, deploy, seed admin, smoke-test at
   send.apps.p97.dev, post the admin token in chat.
