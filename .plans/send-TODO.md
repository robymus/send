# send — TODO

Derived from [send-PLAN.md](send-PLAN.md). Check items off as they land; each phase should end
with lint + typecheck + tests green.

## Phase 1 — Scaffold & quality gates

- [x] `package.json` (ESM, Node 22, scripts: `dev`, `build`, `start`, `lint`, `format`, `typecheck`, `test`, `migrate`), pin deps: fastify 5, `@fastify/static`, `@fastify/multipart`, `@fastify/secure-session`, `pg`, `node-pg-migrate`; dev: typescript, vitest, eslint 9 + typescript-eslint, prettier, `@types/*`
- [x] `tsconfig.json` — strict, ESM (`module: nodenext`), `outDir: dist`, includes `src/`
- [x] `eslint.config.js` (flat) covering `src/`, `test/`, `public/js/`, `migrations/`; `.prettierrc`; verify `npm run lint` passes on empty scaffold
- [x] `vitest.config.ts` (node env, test globs, sequential DB tests)
- [x] `docker-compose.yml` — dev/test Postgres 17 (port 5433, user/db `send`)
- [x] `.github/workflows/ci.yml` — on push/PR: `npm ci`, lint, typecheck, `vitest run` with `postgres:17` service; `DATABASE_URL` env for tests
- [x] `.gitignore` (node_modules, dist, .env), `.dockerignore`, minimal `README.md`
- [x] Commit: scaffold (CI must go green on push)

## Phase 2 — Config, DB, migrations, scripts

- [x] `src/config.ts` — env parsing (`DATABASE_URL`, `SESSION_SECRET`, `DATA_DIR`, `PORT`, `NODE_ENV`) with fail-fast validation
- [x] `src/db.ts` — pg Pool with `options: '-c search_path=send'`; typed row interfaces (`TokenRow`, `FileRow`); query helpers (tokens: findByToken/findById/list/create/updateTtl/updateLimit; files: listByToken/create/findById/delete/sumSizes)
- [x] `migrations/0001_init.js` — `CREATE SCHEMA IF NOT EXISTS send`, `tokens` + `files` tables + index per plan §2
- [x] Migration runner invoked programmatically from server startup (and standalone `npm run migrate`)
- [x] `src/lib/wordlist.ts` — embedded EFF short wordlist (1,296 words) + `generateWordToken()` (3 words, dash-joined)
- [x] `src/lib/humanSize.ts`, `src/lib/flags.ts` (country code → regional-indicator emoji), `src/lib/geoip.ts` (ipwho.is, 1 s timeout, returns `null` on any failure)
- [x] `src/scripts/seed-admin.ts` — refuse if admin exists; generate 40-hex-char token, insert (`Robert`, `is_admin=true`, `expires_at=NULL`), print once to stdout
- [x] `src/scripts/cleanup.ts` — delete expired non-admin tokens (cascade), unlink blobs, orphan-blob sweep (>1 day old)
- [x] Unit tests: wordlist shape/charset, humanSize, flags, token normalization, limit math
- [x] Integration tests (real PG): migrations apply cleanly; seed-admin idempotency; cleanup deletes expired token + files but never admin
- [x] Commit

## Phase 3 — Auth & token API

- [x] `src/app.ts` — `buildApp()` factory: register secure-session (key from `SESSION_SECRET`), static, multipart, `trustProxy: true`, error handler, `/healthz` (200 + DB ping)
- [x] `src/auth.ts` — `requireAuth` (loads token row from session `tokenId`, rejects missing/expired) and `requireAdmin` hooks
- [x] `src/routes/login.ts` — `POST /api/login` (normalize lowercase, expiry check, set session), `POST /api/logout`, `GET /api/me`; in-memory rate limit (10/min/IP) on login
- [x] `src/routes/tokens.ts` — `GET /api/generate-token` (unique-checked), `GET /api/tokens` (list + usage/file counts), `POST /api/tokens` (validate `[a-z0-9-]{6,64}`, name required, ttlDays default 7, limitBytes default 100 MiB), `GET /api/tokens/:id` (admin-or-owner, includes files), `PATCH /api/tokens/:id` (ttlDays → now()+N, limitBytes; admin only)
- [x] JSON schema validation on all bodies/params (Fastify schemas)
- [x] Tests: login case-insensitivity, wrong/expired token → 401, rate limit → 429, `/api/me`, authz matrix (partner on foreign token → 403/404, partner PATCH → 403), create-token validation + collision → 409, TTL update math
- [x] Commit

## Phase 4 — File API

- [x] `src/routes/files.ts` — `POST /api/tokens/:id/files`: pre-check remaining budget (413 early), stream to `DATA_DIR/files/<uuid>` with `limits.fileSize = remaining`, unlink on truncation → 413, geoip best-effort, insert row (`uploaded_by_admin`, `uploader_name`, actual bytes)
- [x] `GET /api/tokens/:id/files/:fileId/download` — stream blob, RFC 5987 `Content-Disposition`, correct content-length
- [x] `DELETE /api/tokens/:id/files/:fileId` — admin any; partner only own non-admin files (403 otherwise); delete row then unlink
- [x] Ensure `DATA_DIR/files` created at startup; blob write uses `flags: 'wx'`
- [x] Tests: upload happy path (row + blob + size), upload exceeding budget via content-length → 413, upload exceeding via stream (no/false content-length) → 413 + no blob/row leak, download roundtrip (bytes + filename header), delete permissions matrix, geoip failure tolerated (mock fetch)
- [x] Commit

## Phase 5 — Frontend

- [x] `public/squirrel.svg` — hand-drawn cartoon squirrel holding an envelope (warm autumn palette per plan §8)
- [x] `public/app.css` — shared styles, palette, responsive single-column layout, logo hero sizing
- [x] `public/index.html` + `js/login.js` — logo hero, token input, submit → `/api/login`; 401 → squirrel head-shake CSS animation; redirect admin → `/admin`, partner → `/t/:id`
- [x] `public/admin.html` + `js/admin.js` — create-token card (token input, 🎲 generate button, name, TTL days=7, limit MB=100) → navigate to `/t/:id`; token table (name, token, expires-in, used/limit, file count) with row links
- [x] `public/token.html` + `js/token.js` — "Hello {name}" (partner) / summary + TTL & limit editors (admin); file list (name, size, uploader, flag emoji, time, download link, delete button with permission-aware visibility); upload via file input + drag-and-drop on squirrel, XHR progress bar; usage meter
- [x] `src/routes/pages.ts` — serve `/`, `/admin`, `/t/:id` (HTML), static assets; unauthenticated page loads bounce to `/` via `/api/me` client guard
- [x] Shared `js/api.js` helper (fetch wrapper, error toasts, humanSize + flag emoji client-side)
- [x] Lint passes on all client JS
- [x] Commit

## Phase 6 — Container & local verification

- [x] `Dockerfile` — multi-stage: build (`npm ci` + `tsc`) → runtime (`node:22-alpine`, prod deps, `dist/`, `public/`, `migrations/`, `EXPOSE 3000`, `CMD node dist/server.js`)
- [x] `src/server.ts` — run migrations, `buildApp()`, listen on `0.0.0.0:$PORT`
- [x] `app.json` — `{"cron":[{"command":"node dist/scripts/cleanup.js","schedule":"@daily"}]}`
- [x] Local end-to-end: `docker compose` DB + built image; exercise real flows in a browser (login, create token, upload incl. drag-drop, download, delete, limit rejection, partner view via second browser profile)
- [x] Local run of cleanup script against a token with past expiry
- [x] Commit; push to GitHub `main`; confirm CI green

## Phase 7 — Deploy & handover

- [ ] `$DK apps:create send`
- [ ] `$DK postgres:link shared send`
- [ ] `$DK storage:ensure-directory send` + `storage:mount send /var/lib/dokku/data/storage/send:/data`
- [ ] `$DK config:set send NODE_ENV=production DATA_DIR=/data SESSION_SECRET=$(openssl rand -hex 32)`
- [ ] `git remote add dokku ssh://dokku@core.p97.dev:42022/send` + push `main`
- [ ] Verify port mapping / `EXPOSE` picked up; `curl https://send.apps.p97.dev/healthz`
- [ ] `$DK run send node dist/scripts/seed-admin.js` → capture admin token, **post in chat**
- [ ] Smoke test on production: admin login, create a test token, upload/download/delete a file, partner login with test token, ~100 MB upload (bump proxy body limit if needed), then remove test artifacts
- [ ] Confirm cron registered (`$DK cron:list send`)
- [ ] Final commit of any deploy tweaks; update README with URL + ops notes
