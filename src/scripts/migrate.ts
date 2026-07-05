import { fileURLToPath, pathToFileURL } from 'node:url';
import { runner } from 'node-pg-migrate';

export async function runMigrations(databaseUrl: string): Promise<void> {
  await runner({
    databaseUrl,
    // dist/scripts/migrate.js and src/scripts/migrate.ts both resolve to <root>/migrations.
    dir: fileURLToPath(new URL('../../migrations', import.meta.url)),
    direction: 'up',
    migrationsTable: 'pgmigrations',
    schema: 'send',
    createSchema: true,
    log: (msg: string) => console.log(`[migrate] ${msg}`),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  await runMigrations(url);
}
