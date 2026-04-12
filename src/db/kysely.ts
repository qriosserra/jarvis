import { Kysely, PostgresDialect, CamelCasePlugin, type Generated } from 'kysely';
import pg from 'pg';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('kysely');

// ── Column-level table types (camelCase) ────────────────────────────
// CamelCasePlugin maps these camelCase properties to snake_case SQL
// columns automatically. Table name keys in Database stay as-is.
// Generated<T> marks columns that have DB-level defaults and are
// therefore optional on INSERT.

export interface GuildsTable {
  id: string;
  name: string;
  joinedAt: Generated<Date>;
  settings: Generated<unknown>; // JSONB, default '{}'
  updatedAt: Generated<Date>;
}

export interface MembersTable {
  id: string;
  guildId: string;
  username: string;
  displayName: string | null;
  joinedAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export interface UsersTable {
  id: string;
  username: string;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export interface GuildMembershipsTable {
  id: Generated<string>; // UUID, default gen_random_uuid()
  guildId: string;
  userId: string;
  displayName: string | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export interface PersonasTable {
  id: Generated<string>; // UUID text, default gen_random_uuid()::text
  name: string;
  description: string | null;
  systemPrompt: string;
  responseStyle: Generated<unknown>; // JSONB, default '{}'
  isDefault: Generated<boolean>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export interface InteractionsTable {
  id: Generated<string>; // UUID
  guildId: string;
  memberId: string;
  membershipId: string | null;
  channelId: string;
  surface: string;
  requestText: string;
  responseText: string | null;
  personaId: string | null;
  language: string | null;
  correlationId: string | null;
  createdAt: Generated<Date>;
}

export interface MemoryRecordsTable {
  id: Generated<string>; // UUID
  guildId: string;
  memberId: string | null;
  membershipId: string | null;
  category: string;
  content: string;
  capability: string | null;
  confidence: Generated<number>;
  sourceInteractionId: string | null;
  expiresAt: Date | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export interface IdentityAliasesTable {
  id: Generated<string>; // UUID
  memberId: string;
  membershipId: string | null;
  guildId: string | null;
  aliasType: string;
  value: string;
  source: string;
  confidence: Generated<number>;
  confirmed: Generated<boolean>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export interface ActionOutcomesTable {
  id: Generated<string>; // UUID
  interactionId: string;
  guildId: string;
  actionType: string;
  targetMemberId: string | null;
  targetMembershipId: string | null;
  targetChannelId: string | null;
  success: boolean;
  errorMessage: string | null;
  metadata: Generated<unknown>; // JSONB, default '{}'
  createdAt: Generated<Date>;
}

export interface EmbeddingsTable {
  id: Generated<string>; // UUID
  memoryRecordId: string;
  embedding: unknown; // pgvector — handled via raw SQL
  model: string;
  createdAt: Generated<Date>;
}

export interface OperationLatenciesTable {
  id: Generated<string>; // UUID
  interactionId: string | null;
  correlationId: string | null;
  guildId: string | null;
  memberId: string | null;
  membershipId: string | null;
  operationName: string;
  operationType: string;
  parentOperationId: string | null;
  providerName: string | null;
  model: string | null;
  status: string;
  durationMs: number | null;
  startedAt: Date;
  metadata: Generated<unknown>; // JSONB, default '{}'
  createdAt: Generated<Date>;
}

export interface MigrationsTable {
  name: string;
  appliedAt: Generated<Date>;
}

// ── Aggregate database interface ────────────────────────────────────

export interface Database {
  guilds: GuildsTable;
  members: MembersTable;
  users: UsersTable;
  guild_memberships: GuildMembershipsTable;
  personas: PersonasTable;
  interactions: InteractionsTable;
  memory_records: MemoryRecordsTable;
  identity_aliases: IdentityAliasesTable;
  action_outcomes: ActionOutcomesTable;
  embeddings: EmbeddingsTable;
  operation_latencies: OperationLatenciesTable;
  _migrations: MigrationsTable;
}

// ── Factory ─────────────────────────────────────────────────────────

export function createDb(connectionString: string): Kysely<Database> {
  const pool = new pg.Pool({ connectionString });

  const db = new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
    plugins: [new CamelCasePlugin()],
  });

  logger.debug('Kysely instance created');
  return db;
}

/** Extract the underlying pg Pool from a Kysely instance (escape hatch for pgvector raw SQL). */
export function getPool(db: Kysely<Database>): pg.Pool {
  // The PostgresDialect stores the pool in the driver.
  // We need a type-safe way to get it — use the executor's adapter.
  return (db as any).getExecutor().adapter.pool ??
         (db as any)._pool ??
         (() => { throw new Error('Cannot extract pg Pool from Kysely instance'); })();
}
