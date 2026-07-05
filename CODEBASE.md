# send — codebase reference

Token-based file-transfer app. Fastify (TypeScript, ESM) serves a JSON API **and** the static
frontend; metadata in Postgres (schema `send`), blobs on disk at `$DATA_DIR/files/<uuid>`. Auth is
one token per person, exchanged for an encrypted session cookie. Deploy target:
`https://send.apps.p97.dev` (dokku app `send`). Full plan: [.plans/send-PLAN.md](.plans/send-PLAN.md);
spec: [SEND.md](SEND.md).

## Layout

```
src/
├─ server.ts          # entrypoint: loadConfig → runMigrations → ensureBlobDir → buildApp → listen; SIGTERM/SIGINT graceful close
├─ app.ts             # buildApp(deps): fastify + cookie/multipart plugins, loadAuth hook, error handler, /healthz, wires all routes
├─ config.ts          # loadConfig(): env parse + fail-fast validation (DATABASE_URL, SESSION_SECRET≥32, DATA_DIR, PORT, NODE_ENV)
├─ db.ts              # createPool() (search_path=send, INT8→number); tokens.* and files.* query helpers; TokenRow/FileRow types
├─ auth.ts            # loadAuth onRequest hook (sets request.auth from session tokenId); requireAdmin / requireTokenAccess preHandlers
├─ routes/
│  ├─ login.ts        # POST /api/login (normalize+expiry, rate-limited), POST /api/logout, GET /api/me
│  ├─ tokens.ts       # generate-token, list, create (validate [a-z0-9-]{6,64}, collision→409), detail (admin-or-owner), PATCH (admin)
│  ├─ files.ts        # upload (budget pre-check + stream cap→413), download (RFC 5987 disposition), delete (permission matrix)
│  └─ pages.ts        # @fastify/static (root=public/, index:false) + GET / /admin /t/:id → HTML
├─ lib/
│  ├─ wordlist.ts     # generateWordToken(): 3 dash-joined EFF words   words.ts: the 1,296-word list
│  ├─ geoip.ts        # lookupCountry(ip): ipwho.is, 1.5 s timeout, null on any failure
│  ├─ humanSize.ts  flags.ts  blobs.ts (blobDir/blobPath/ensureBlobDir)  rateLimit.ts (in-memory fixed-window)
└─ scripts/
   ├─ migrate.ts      # runMigrations(url): node-pg-migrate up, schema send, table pgmigrations
   ├─ seed-admin.ts   # generate 40-hex admin token, insert (Robert, is_admin, no expiry), print once; refuse if admin exists
   └─ cleanup.ts      # cleanup(): delete expired non-admin tokens (cascade) + blobs; orphan-blob sweep (>1 day). Daily cron.
migrations/0001_init.js  # CREATE SCHEMA send; tokens + files tables + files_token_id_uploaded_at_idx
public/                  # index/admin/token .html, app.css, squirrel.svg, js/{api,login,admin,token}.js
test/                    # vitest: lib.test, auth.test, tokens.test, files.test, scripts.test (57 tests, real Postgres)
```

## Frontend (no framework, no bundler)

Three static pages + shared ES-module helpers, linted by the same ESLint flat config (`public/js/**`).

- **`js/api.js`** — shared: `api()` fetch wrapper (JSON in/out, throws with server error message),
  `me()`/`logout()`, plus client-side `humanSize()`, `countryFlag()` (regional-indicator codepoints),
  `formatTime()`, `daysLeft()`, `el()`.
- **`index.html` + `js/login.js`** — logo hero, token input; already-logged-in → redirect; 401 →
  squirrel `.shake` CSS animation. Admin → `/admin`, partner → `/t/:tokenId`.
- **`admin.html` + `js/admin.js`** — create-token card (🎲 calls `/api/generate-token`), token table
  (rows link to `/t/:id`; admin token masked). Non-admin sessions bounce to their token page.
- **`token.html` + `js/token.js`** — role-aware header ("Hello {name}" vs admin summary + TTL/limit
  editors); file list with download links + permission-aware delete buttons; usage meter; upload via
  file input **and** drag-and-drop onto the squirrel, with an XHR progress bar. Delete buttons are
  hidden for partners on admin-uploaded files (server enforces regardless).

The API returns camelCase JSON (`tokenJson`/`fileJson` in `routes/tokens.ts`); `bigint` columns are
parsed as JS numbers globally (`db.ts`) so client-side size math is safe.

## Auth / sessions

`@fastify/cookie` (signed with `SESSION_SECRET`) stores only `tokenId`; `loadAuth` re-loads the token
row every request, so expiry/deletion take effect immediately. `requireAdmin` gates admin routes;
`requireTokenAccess` allows admin-any / partner-own (`params.id === auth.token.id`).

## Upload & the per-token size cap

Limit is total stored bytes per token (default 100 MiB, admin-editable, 1 GiB hard cap). Enforced
twice: a `content-length` pre-check (413 early, with 16 KiB multipart slack) and a hard
`limits.fileSize = remaining` stream cap — on truncation the partial blob is unlinked and 413 returned.
Blob writes use `flags: 'wx'`. Uploader identity denormalized onto the file row.

## Container & ops

- **Dockerfile** — multi-stage: build stage (`npm ci` + `tsc`) → runtime `node:22-alpine` (prod deps,
  `dist/`, `public/`, `migrations/`). Runs as uid **32767** (matches dokku storage-mount owner so
  `/data` is writable). `EXPOSE 3000`, `CMD node dist/server.js`.
- **server.ts** runs `node-pg-migrate up` (idempotent) before listening.
- **app.json** — dokku daily cron: `node dist/scripts/cleanup.js`.
- **CI** (`.github/workflows/ci.yml`) — lint + typecheck + vitest against a `postgres:17` service.

## Quality gates

`npm run lint` (ESLint flat, type-checked rules on `src`/`test`), `npm run typecheck` (`tsc --noEmit`),
`npm test` (vitest, 57 tests). All green. A manual real-HTTP e2e (31 checks: full auth/upload/download/
delete/limit/static flow) is in this session's scratch (`/tmp/e2e.mjs`, not committed).
