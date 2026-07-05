import pg from 'pg';

// Sizes and sums fit comfortably in a JS number; parse int8 as number app-wide.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export interface TokenRow {
  id: string;
  token: string;
  name: string;
  is_admin: boolean;
  limit_bytes: number;
  expires_at: Date | null;
  created_at: Date;
}

export interface TokenListRow extends TokenRow {
  used_bytes: number;
  file_count: number;
}

export interface FileRow {
  id: string;
  token_id: string;
  name: string;
  size_bytes: number;
  uploaded_by_admin: boolean;
  uploader_name: string;
  country_code: string | null;
  uploaded_at: Date;
}

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({
    connectionString: databaseUrl,
    options: '-c search_path=send',
    max: 10,
  });
}

type Queryable = pg.Pool | pg.PoolClient;

export const tokens = {
  async findByToken(db: Queryable, token: string): Promise<TokenRow | null> {
    const r = await db.query<TokenRow>('SELECT * FROM tokens WHERE token = $1', [token]);
    return r.rows[0] ?? null;
  },

  async findById(db: Queryable, id: string): Promise<TokenRow | null> {
    const r = await db.query<TokenRow>('SELECT * FROM tokens WHERE id = $1', [id]);
    return r.rows[0] ?? null;
  },

  async list(db: Queryable): Promise<TokenListRow[]> {
    const r = await db.query<TokenListRow>(
      `SELECT t.*,
              COALESCE(SUM(f.size_bytes), 0)::bigint AS used_bytes,
              COUNT(f.id)::bigint AS file_count
         FROM tokens t
         LEFT JOIN files f ON f.token_id = t.id
        GROUP BY t.id
        ORDER BY t.created_at DESC`,
    );
    return r.rows;
  },

  async create(
    db: Queryable,
    args: {
      token: string;
      name: string;
      isAdmin?: boolean;
      limitBytes?: number;
      expiresAt: Date | null;
    },
  ): Promise<TokenRow> {
    const r = await db.query<TokenRow>(
      `INSERT INTO tokens (token, name, is_admin, limit_bytes, expires_at)
       VALUES ($1, $2, $3, COALESCE($4, 104857600), $5)
       RETURNING *`,
      [args.token, args.name, args.isAdmin ?? false, args.limitBytes ?? null, args.expiresAt],
    );
    return r.rows[0]!;
  },

  async update(
    db: Queryable,
    id: string,
    patch: { expiresAt?: Date; limitBytes?: number },
  ): Promise<TokenRow | null> {
    const r = await db.query<TokenRow>(
      `UPDATE tokens
          SET expires_at = COALESCE($2, expires_at),
              limit_bytes = COALESCE($3, limit_bytes)
        WHERE id = $1
        RETURNING *`,
      [id, patch.expiresAt ?? null, patch.limitBytes ?? null],
    );
    return r.rows[0] ?? null;
  },

  async adminExists(db: Queryable): Promise<boolean> {
    const r = await db.query('SELECT 1 FROM tokens WHERE is_admin LIMIT 1');
    return r.rows.length > 0;
  },
};

export const files = {
  async listByToken(db: Queryable, tokenId: string): Promise<FileRow[]> {
    const r = await db.query<FileRow>(
      'SELECT * FROM files WHERE token_id = $1 ORDER BY uploaded_at, id',
      [tokenId],
    );
    return r.rows;
  },

  async findById(db: Queryable, tokenId: string, fileId: string): Promise<FileRow | null> {
    const r = await db.query<FileRow>('SELECT * FROM files WHERE id = $1 AND token_id = $2', [
      fileId,
      tokenId,
    ]);
    return r.rows[0] ?? null;
  },

  async create(
    db: Queryable,
    args: {
      id: string;
      tokenId: string;
      name: string;
      sizeBytes: number;
      uploadedByAdmin: boolean;
      uploaderName: string;
      countryCode: string | null;
    },
  ): Promise<FileRow> {
    const r = await db.query<FileRow>(
      `INSERT INTO files (id, token_id, name, size_bytes, uploaded_by_admin, uploader_name, country_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        args.id,
        args.tokenId,
        args.name,
        args.sizeBytes,
        args.uploadedByAdmin,
        args.uploaderName,
        args.countryCode,
      ],
    );
    return r.rows[0]!;
  },

  async deleteById(db: Queryable, fileId: string): Promise<void> {
    await db.query('DELETE FROM files WHERE id = $1', [fileId]);
  },

  async usedBytes(db: Queryable, tokenId: string): Promise<number> {
    const r = await db.query<{ used: number }>(
      'SELECT COALESCE(SUM(size_bytes), 0)::bigint AS used FROM files WHERE token_id = $1',
      [tokenId],
    );
    return r.rows[0]!.used;
  },
};
