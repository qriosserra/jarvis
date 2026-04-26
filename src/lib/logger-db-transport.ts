import build from 'pino-abstract-transport';
import pg from 'pg';

/**
 * Pino worker-thread transport that persists structured log entries
 * into the `log` table via its own `pg.Pool`.
 *
 * Activated by the `LOG_DB_ENABLED=true` env var. The transport is
 * self-contained — it does not depend on the application's Kysely
 * instance or container.
 */

// ── Pino numeric level → human-readable label ───────────────────────

const LEVEL_LABELS: Record<number, string> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
};

function levelLabel(level: number): string {
  return LEVEL_LABELS[level] ?? String(level);
}

// ── Known fields that map to dedicated columns ──────────────────────

const KNOWN_FIELDS = new Set([
  'level', 'msg', 'time', 'module', 'source',
  'correlationId', 'interactionId', 'guildId', 'memberId',
  'status', 'durationMs',
  // Pino internals to strip (not stored)
  'pid', 'hostname', 'v',
]);

const SKIP_FIELDS = new Set(['pid', 'hostname', 'v']);

// ── INSERT statement ────────────────────────────────────────────────

const INSERT_SQL = `
  INSERT INTO log (
    level, message, module, source,
    correlation_id, interaction_id, guild_id, member_id,
    status, duration_ms, metadata, logged_at
  ) VALUES (
    $1, $2, $3, $4,
    $5, $6, $7, $8,
    $9, $10, $11, $12
  )
`;

// ── Transport factory ───────────────────────────────────────────────

export default async function createLogDbTransport(
  options: { connectionString?: string },
) {
  const connectionString =
    options.connectionString ?? process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      'logger-db-transport: DATABASE_URL is required when LOG_DB_ENABLED=true',
    );
  }

  const pool = new pg.Pool({
    connectionString,
    max: 2,
    idleTimeoutMillis: 30_000,
  });

  return build(
    async function processLogEntry(source: AsyncIterable<Record<string, unknown>>) {
      for await (const obj of source) {
        try {
          await insertLogRow(pool, obj);
        } catch {
          // Observability must never break user-facing flows.
          // Silently drop rows that fail to insert.
        }
      }
    },
    {
      async close() {
        await pool.end();
      },
    },
  );
}

// ── Row insertion ───────────────────────────────────────────────────

async function insertLogRow(
  pool: pg.Pool,
  obj: Record<string, unknown>,
): Promise<void> {
  const level = levelLabel(obj.level as number);
  const message = (obj.msg as string) ?? '';
  const module = (obj.module as string) ?? null;
  const source = (obj.source as string) ?? null;
  const correlationId = (obj.correlationId as string) ?? null;
  const interactionId = (obj.interactionId as string) ?? null;
  const guildId = (obj.guildId as string) ?? null;
  const memberId = (obj.memberId as string) ?? null;
  const status = (obj.status as string) ?? null;
  const durationMs = typeof obj.durationMs === 'number' ? obj.durationMs : null;
  const loggedAt = obj.time ? new Date(obj.time as number) : new Date();

  // Everything not in KNOWN_FIELDS goes into the metadata JSONB column
  const metadata: Record<string, unknown> = {};
  if (obj.metadata && typeof obj.metadata === 'object') {
    Object.assign(metadata, obj.metadata);
  }
  for (const [key, value] of Object.entries(obj)) {
    if (!KNOWN_FIELDS.has(key) && key !== 'metadata' && value !== undefined) {
      metadata[key] = value;
    }
  }

  await pool.query(INSERT_SQL, [
    level,
    message,
    module,
    source,
    correlationId,
    interactionId,
    guildId,
    memberId,
    status,
    durationMs,
    JSON.stringify(metadata),
    loggedAt,
  ]);
}
