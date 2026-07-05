import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { ensureBlobDir } from './lib/blobs.js';
import { runMigrations } from './scripts/migrate.js';

const config = loadConfig();
await runMigrations(config.databaseUrl);
await ensureBlobDir(config.dataDir);

const pool = createPool(config.databaseUrl);
const app = await buildApp({ config, pool });

const shutdown = async (signal: string) => {
  app.log.info(`${signal} received, shutting down`);
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: '0.0.0.0', port: config.port });
