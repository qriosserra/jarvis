import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('migrate');

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');
const SCHEMA_FILE = join(__dirname, 'schema.sql');

/** Reserved marker recorded in _migration when schema.sql bootstraps the DB */
const SCHEMA_MARKER = 'schema.sql';

export async function runMigrations(pool: Pool): Promise<void> {
  // Ensure the _migration table exists (idempotent)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migration (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const applied = await pool
    .query<{ name: string }>('SELECT name FROM _migration ORDER BY name')
    .then((r) => new Set(r.rows.map((row) => row.name)));

  const hasSchemaFile = existsSync(SCHEMA_FILE);
  const schemaAlreadyApplied = applied.has(SCHEMA_MARKER);

  // Determine numbered migration history (anything other than the schema marker)
  const numberedApplied = new Set([...applied].filter((n) => n !== SCHEMA_MARKER));

  // ── Schema-file path ──────────────────────────────────────────────
  if (hasSchemaFile) {
    if (schemaAlreadyApplied) {
      logger.info('schema-file-already-applied — skipping schema.sql');
      return;
    }

    // Safety: refuse to apply schema.sql over a DB with existing numbered migrations
    if (numberedApplied.size > 0) {
      const names = [...numberedApplied].sort().join(', ');
      throw new Error(
        `Cannot apply schema.sql: database already has numbered migration history (${names}). ` +
        'Reset the database before switching to schema.sql bootstrapping.',
      );
    }

    const sql = await readFile(SCHEMA_FILE, 'utf-8');

    await pool.query('BEGIN');
    try {
      await pool.query(sql);
      await pool.query('INSERT INTO _migration (name) VALUES ($1)', [SCHEMA_MARKER]);
      await pool.query('COMMIT');
      logger.info('schema-file — applied schema.sql');
    } catch (err) {
      await pool.query('ROLLBACK');
      logger.error({ err }, 'schema-file — failed to apply schema.sql');
      throw err;
    }
    return;
  }

  // ── Numbered-migration fallback ───────────────────────────────────
  if (!existsSync(MIGRATIONS_DIR)) {
    throw new Error(
      `Neither schema.sql nor migrations directory found under ${__dirname}. ` +
      'Ensure SQL assets are copied into the runtime image.',
    );
  }

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  logger.info({ count: files.length }, 'numbered-migrations — running migration files');

  for (const file of files) {
    if (applied.has(file)) {
      logger.debug({ file }, 'Migration already applied');
      continue;
    }

    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf-8');

    await pool.query('BEGIN');
    try {
      await pool.query(sql);
      await pool.query('INSERT INTO _migration (name) VALUES ($1)', [file]);
      await pool.query('COMMIT');
      logger.info({ file }, 'Migration applied');
    } catch (err) {
      await pool.query('ROLLBACK');
      logger.error({ file, err }, 'Migration failed');
      throw err;
    }
  }
}
