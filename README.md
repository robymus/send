# send

Minimal token-based file transfer app. One token per person; log in with the token, upload
and download files under it. Tokens expire (TTL) and carry a total size limit. See
[SEND.md](SEND.md) for the original spec.

Live at **https://send.apps.p97.dev**.

## Development

```bash
docker compose up -d db        # Postgres 17 on localhost:5433
npm install
npm run dev                    # http://localhost:3000
```

Env vars (see `src/config.ts`): `DATABASE_URL`, `SESSION_SECRET`, `DATA_DIR` (blob storage,
default `./data`), `PORT` (default 3000).

Quality gates: `npm run lint`, `npm run typecheck`, `npm test` (needs the dev Postgres).

## Operations

- Deployed on dokku (`core.p97.dev`) as app `send`; shared Postgres schema `send`; blobs on
  the `/data` storage mount.
- Daily cron (`app.json`) runs `dist/scripts/cleanup.js`: deletes expired tokens, their file
  rows (cascade) and blobs, and sweeps orphaned blobs.
- One-time admin seed: `dokku run send node dist/scripts/seed-admin.js` (prints the admin
  token once; refuses to run if an admin already exists).
