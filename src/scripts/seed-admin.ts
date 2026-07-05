import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import type pg from 'pg';
import { loadConfig } from '../config.js';
import { createPool, tokens } from '../db.js';
import { runMigrations } from './migrate.js';

/**
 * Create the admin token (name "Robert", no expiry). Refuses to run if an admin
 * already exists so it can never silently rotate the credential.
 * Returns the generated token — the only place it is ever revealed.
 */
export async function seedAdmin(pool: pg.Pool): Promise<string> {
  if (await tokens.adminExists(pool)) {
    throw new Error('An admin token already exists; refusing to create another.');
  }
  const token = randomBytes(20).toString('hex'); // 40 lowercase hex chars, 160 bits
  await tokens.create(pool, { token, name: 'Robert', isAdmin: true, expiresAt: null });
  return token;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig();
  await runMigrations(config.databaseUrl);
  const pool = createPool(config.databaseUrl);
  try {
    const token = await seedAdmin(pool);
    console.log(`Admin token created for "Robert" (store it now, it is not shown again):`);
    console.log(token);
  } finally {
    await pool.end();
  }
}
