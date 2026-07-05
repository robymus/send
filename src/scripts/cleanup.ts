import { readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type pg from 'pg';
import { loadConfig } from '../config.js';
import { createPool } from '../db.js';
import { blobDir, blobPath } from '../lib/blobs.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;

export interface CleanupResult {
  tokensDeleted: number;
  blobsDeleted: number;
  orphansDeleted: number;
}

/**
 * Daily GC: delete expired non-admin tokens (file rows cascade) and their blobs,
 * then sweep orphaned blobs (>1 day old, no DB row) left by crashes mid-delete.
 */
export async function cleanup(pool: pg.Pool, dataDir: string): Promise<CleanupResult> {
  const result: CleanupResult = { tokensDeleted: 0, blobsDeleted: 0, orphansDeleted: 0 };

  const expired = await pool.query<{ id: string; file_ids: string[] }>(
    `SELECT t.id, array_remove(array_agg(f.id), NULL) AS file_ids
       FROM tokens t
       LEFT JOIN files f ON f.token_id = t.id
      WHERE NOT t.is_admin AND t.expires_at < now()
      GROUP BY t.id`,
  );
  for (const row of expired.rows) {
    await pool.query('DELETE FROM tokens WHERE id = $1', [row.id]);
    result.tokensDeleted++;
    for (const fileId of row.file_ids) {
      await unlink(blobPath(dataDir, fileId)).catch(() => {});
      result.blobsDeleted++;
    }
  }

  let names: string[];
  try {
    names = await readdir(blobDir(dataDir));
  } catch {
    return result; // no blob dir yet — nothing to sweep
  }
  const known = new Set(
    (await pool.query<{ id: string }>('SELECT id FROM files')).rows.map((r) => r.id),
  );
  for (const name of names) {
    if (!UUID_RE.test(name) || known.has(name)) continue;
    const fullPath = path.join(blobDir(dataDir), name);
    try {
      const s = await stat(fullPath);
      if (Date.now() - s.mtimeMs < ORPHAN_MIN_AGE_MS) continue;
      await unlink(fullPath);
      result.orphansDeleted++;
    } catch {
      // raced with a concurrent delete — fine
    }
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  try {
    const result = await cleanup(pool, config.dataDir);
    console.log(
      `cleanup: ${result.tokensDeleted} tokens, ${result.blobsDeleted} blobs, ` +
        `${result.orphansDeleted} orphans deleted`,
    );
  } finally {
    await pool.end();
  }
}
