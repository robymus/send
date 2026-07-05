/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export function up(pgm) {
  pgm.sql(`
    CREATE TABLE tokens (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      token       text NOT NULL UNIQUE,
      name        text NOT NULL,
      is_admin    boolean NOT NULL DEFAULT false,
      limit_bytes bigint NOT NULL DEFAULT 104857600,
      expires_at  timestamptz,
      created_at  timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE files (
      id                uuid PRIMARY KEY,
      token_id          uuid NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
      name              text NOT NULL,
      size_bytes        bigint NOT NULL,
      uploaded_by_admin boolean NOT NULL,
      uploader_name     text NOT NULL,
      country_code      text,
      uploaded_at       timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX files_token_id_uploaded_at_idx ON files (token_id, uploaded_at);
  `);
}

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export function down(pgm) {
  pgm.sql('DROP TABLE files; DROP TABLE tokens;');
}
