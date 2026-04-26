import { Kysely, sql, type SqlBool } from 'kysely';
import type { Database } from './kysely.js';
import type {
  Guild, Member, User, GuildMembership, Persona, Interaction,
  MemoryRecord, IdentityAlias, ActionOutcome, Embedding,
  Surface, MemoryCategory, AliasType, AliasSource,
} from './types.js';

type Db = Kysely<Database>;

// Helper: cast result row to domain type. CamelCasePlugin output
// matches our domain types so the cast is structurally sound.
function as_<T>(row: unknown): T { return row as T; }

// ── Guilds ──────────────────────────────────────────────────────────

export class GuildRepo {
  constructor(private db: Db) {}

  async upsert(data: { id: string; name: string; settings?: Record<string, unknown> }): Promise<Guild> {
    const settings = JSON.stringify(data.settings ?? {});
    const row = await this.db
      .insertInto('guild')
      .values({ id: data.id, name: data.name, settings })
      .onConflict((oc) =>
        oc.column('id').doUpdateSet((eb) => ({
          name: eb.val(data.name),
          settings: sql`COALESCE(${settings}::jsonb, guild.settings)`,
          updatedAt: sql`now()`,
        })),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
    return as_<Guild>(row);
  }

  async findById(id: string): Promise<Guild | null> {
    const row = await this.db
      .selectFrom('guild').selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? as_<Guild>(row) : null;
  }

  async list(): Promise<Guild[]> {
    const rows = await this.db
      .selectFrom('guild').selectAll()
      .orderBy('joinedAt', 'asc')
      .execute();
    return rows.map(as_<Guild>);
  }
}

// ── Members ─────────────────────────────────────────────────────────

export class MemberRepo {
  constructor(private db: Db) {}

  async upsert(data: {
    id: string; guildId: string; username: string; displayName?: string | null;
  }): Promise<Member> {
    const row = await this.db
      .insertInto('member')
      .values({
        id: data.id, guildId: data.guildId,
        username: data.username, displayName: data.displayName ?? null,
      })
      .onConflict((oc) =>
        oc.columns(['id', 'guildId']).doUpdateSet((eb) => ({
          username: eb.val(data.username),
          displayName: sql`COALESCE(${data.displayName ?? null}, member.display_name)`,
          updatedAt: sql`now()`,
        })),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
    return as_<Member>(row);
  }

  async findByGuildAndId(guildId: string, memberId: string): Promise<Member | null> {
    const row = await this.db
      .selectFrom('member').selectAll()
      .where('guildId', '=', guildId).where('id', '=', memberId)
      .executeTakeFirst();
    return row ? as_<Member>(row) : null;
  }

  async listByGuild(guildId: string): Promise<Member[]> {
    const rows = await this.db
      .selectFrom('member').selectAll()
      .where('guildId', '=', guildId).orderBy('username', 'asc')
      .execute();
    return rows.map(as_<Member>);
  }
}

// ── Users ───────────────────────────────────────────────────────────

export class UserRepo {
  constructor(private db: Db) {}

  async upsert(data: { id: string; username: string }): Promise<User> {
    const row = await this.db
      .insertInto('user')
      .values({ id: data.id, username: data.username })
      .onConflict((oc) =>
        oc.column('id').doUpdateSet((eb) => ({
          username: eb.val(data.username),
          updatedAt: sql`now()`,
        })),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
    return as_<User>(row);
  }

  async findById(id: string): Promise<User | null> {
    const row = await this.db
      .selectFrom('user').selectAll()
      .where('id', '=', id).executeTakeFirst();
    return row ? as_<User>(row) : null;
  }
}

// ── Guild Memberships ───────────────────────────────────────────────

export class GuildMembershipRepo {
  constructor(private db: Db) {}

  async upsert(data: {
    guildId: string; userId: string; displayName?: string | null;
  }): Promise<GuildMembership> {
    const row = await this.db
      .insertInto('guild_membership')
      .values({
        guildId: data.guildId, userId: data.userId,
        displayName: data.displayName ?? null,
      })
      .onConflict((oc) =>
        oc.columns(['guildId', 'userId']).doUpdateSet(() => ({
          displayName: sql`COALESCE(${data.displayName ?? null}, guild_membership.display_name)`,
          updatedAt: sql`now()`,
        })),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
    return as_<GuildMembership>(row);
  }

  async findByGuildAndUser(guildId: string, userId: string): Promise<GuildMembership | null> {
    const row = await this.db
      .selectFrom('guild_membership').selectAll()
      .where('guildId', '=', guildId).where('userId', '=', userId)
      .executeTakeFirst();
    return row ? as_<GuildMembership>(row) : null;
  }

  async findById(id: string): Promise<GuildMembership | null> {
    const row = await this.db
      .selectFrom('guild_membership').selectAll()
      .where('id', '=', id).executeTakeFirst();
    return row ? as_<GuildMembership>(row) : null;
  }

  async listByGuild(guildId: string): Promise<GuildMembership[]> {
    return (await this.db.selectFrom('guild_membership').selectAll()
      .where('guildId', '=', guildId).orderBy('createdAt', 'asc').execute())
      .map(as_<GuildMembership>);
  }

  async listByUser(userId: string): Promise<GuildMembership[]> {
    return (await this.db.selectFrom('guild_membership').selectAll()
      .where('userId', '=', userId).orderBy('createdAt', 'asc').execute())
      .map(as_<GuildMembership>);
  }
}

// ── Personas ────────────────────────────────────────────────────────

export class PersonaRepo {
  constructor(private db: Db) {}

  async create(data: {
    name: string; description?: string; systemPrompt: string;
    responseStyle?: Record<string, unknown>; isDefault?: boolean;
  }): Promise<Persona> {
    const row = await this.db
      .insertInto('persona')
      .values({
        name: data.name,
        description: data.description ?? null,
        systemPrompt: data.systemPrompt,
        responseStyle: JSON.stringify(data.responseStyle ?? {}),
        isDefault: data.isDefault ?? false,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return as_<Persona>(row);
  }

  async findByName(name: string): Promise<Persona | null> {
    const row = await this.db.selectFrom('persona').selectAll()
      .where('name', '=', name).executeTakeFirst();
    return row ? as_<Persona>(row) : null;
  }

  async findDefault(): Promise<Persona | null> {
    const row = await this.db.selectFrom('persona').selectAll()
      .where('isDefault', '=', true).executeTakeFirst();
    return row ? as_<Persona>(row) : null;
  }

  async list(): Promise<Persona[]> {
    return (await this.db.selectFrom('persona').selectAll()
      .orderBy('name', 'asc').execute()).map(as_<Persona>);
  }
}

// ── Interactions ────────────────────────────────────────────────────

export class InteractionRepo {
  constructor(private db: Db) {}

  async create(data: {
    guildId: string; memberId: string; membershipId?: string | null;
    channelId: string; surface: Surface; requestText: string;
    responseText?: string | null; personaId?: string | null;
    language?: string | null; correlationId?: string | null;
  }): Promise<Interaction> {
    const row = await this.db
      .insertInto('interaction')
      .values({
        guildId: data.guildId, memberId: data.memberId,
        membershipId: data.membershipId ?? null,
        channelId: data.channelId, surface: data.surface,
        requestText: data.requestText,
        responseText: data.responseText ?? null,
        personaId: data.personaId ?? null,
        language: data.language ?? null,
        correlationId: data.correlationId ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return as_<Interaction>(row);
  }

  async updateResponse(id: string, responseText: string): Promise<void> {
    await this.db.updateTable('interaction')
      .set({ responseText }).where('id', '=', id).execute();
  }

  async update(id: string, data: {
    responseText?: string | null; personaId?: string | null; language?: string | null;
  }): Promise<void> {
    const sets: Record<string, unknown> = {};
    if (data.responseText !== undefined) sets.responseText = data.responseText;
    if (data.personaId !== undefined) sets.personaId = data.personaId;
    if (data.language !== undefined) sets.language = data.language;
    if (Object.keys(sets).length === 0) return;
    await this.db.updateTable('interaction').set(sets).where('id', '=', id).execute();
  }

  async findById(id: string): Promise<Interaction | null> {
    const row = await this.db.selectFrom('interaction').selectAll()
      .where('id', '=', id).executeTakeFirst();
    return row ? as_<Interaction>(row) : null;
  }

  async listByGuild(
    guildId: string,
    opts?: { memberId?: string; limit?: number; before?: Date },
  ): Promise<Interaction[]> {
    let q = this.db.selectFrom('interaction').selectAll()
      .where('guildId', '=', guildId);
    if (opts?.memberId) q = q.where('memberId', '=', opts.memberId);
    if (opts?.before) q = q.where('createdAt', '<', opts.before);
    return (await q.orderBy('createdAt', 'desc').limit(opts?.limit ?? 50).execute())
      .map(as_<Interaction>);
  }
}

// ── Memory Records ──────────────────────────────────────────────────

export class MemoryRecordRepo {
  constructor(private db: Db) {}

  async create(data: {
    guildId: string; memberId?: string | null; membershipId?: string | null;
    category: MemoryCategory; content: string; capability?: string | null;
    confidence?: number; sourceInteractionId?: string | null; expiresAt?: Date | null;
  }): Promise<MemoryRecord> {
    const row = await this.db
      .insertInto('memory_record')
      .values({
        guildId: data.guildId, memberId: data.memberId ?? null,
        membershipId: data.membershipId ?? null,
        category: data.category, content: data.content,
        capability: data.capability ?? null,
        confidence: data.confidence ?? 1.0,
        sourceInteractionId: data.sourceInteractionId ?? null,
        expiresAt: data.expiresAt ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return as_<MemoryRecord>(row);
  }

  async findById(id: string): Promise<MemoryRecord | null> {
    const row = await this.db.selectFrom('memory_record').selectAll()
      .where('id', '=', id).executeTakeFirst();
    return row ? as_<MemoryRecord>(row) : null;
  }

  async listByGuild(
    guildId: string,
    opts?: { memberId?: string; category?: MemoryCategory; capability?: string; limit?: number },
  ): Promise<MemoryRecord[]> {
    let q = this.db.selectFrom('memory_record').selectAll()
      .where('guildId', '=', guildId)
      .where(sql<SqlBool>`(expires_at IS NULL OR expires_at > now())`);
    if (opts?.memberId) q = q.where('memberId', '=', opts.memberId);
    if (opts?.category) q = q.where('category', '=', opts.category);
    if (opts?.capability) q = q.where('capability', '=', opts.capability);
    return (await q.orderBy('createdAt', 'desc').limit(opts?.limit ?? 50).execute())
      .map(as_<MemoryRecord>);
  }

  async updateConfidence(id: string, confidence: number): Promise<void> {
    await this.db.updateTable('memory_record')
      .set({ confidence, updatedAt: sql`now()` })
      .where('id', '=', id).execute();
  }

  async deleteExpired(): Promise<number> {
    const result = await this.db.deleteFrom('memory_record')
      .where('expiresAt', 'is not', null)
      .where(sql<SqlBool>`expires_at <= now()`)
      .executeTakeFirst();
    return Number(result.numDeletedRows ?? 0);
  }
}

// ── Identity Aliases ────────────────────────────────────────────────

export class IdentityAliasRepo {
  constructor(private db: Db) {}

  async upsert(data: {
    memberId: string; membershipId?: string | null; guildId?: string | null;
    aliasType: AliasType; value: string; source: AliasSource;
    confidence?: number; confirmed?: boolean;
  }): Promise<IdentityAlias> {
    const guildId = data.guildId ?? null;
    const membershipId = data.membershipId ?? null;
    const confidence = data.confidence ?? 1.0;
    const confirmed = data.confirmed ?? false;

    // Preserve the existing CTE-based upsert semantics via raw SQL
    // because Kysely's onConflict can't handle the COALESCE-based
    // unique index match (member_id, COALESCE(guild_id, '__global__'), alias_type).
    const { rows } = await sql<IdentityAlias>`
      WITH existing AS (
        SELECT id FROM identity_alias
        WHERE member_id = ${data.memberId}
          AND COALESCE(guild_id, '__global__') = COALESCE(${guildId}, '__global__')
          AND alias_type = ${data.aliasType}
      ),
      ins AS (
        INSERT INTO identity_alias (member_id, guild_id, alias_type, value, source, confidence, confirmed, membership_id)
        SELECT ${data.memberId}, ${guildId}, ${data.aliasType}, ${data.value}, ${data.source}, ${confidence}, ${confirmed}, ${membershipId}
        WHERE NOT EXISTS (SELECT 1 FROM existing)
        RETURNING id, member_id AS "memberId", membership_id AS "membershipId",
          guild_id AS "guildId", alias_type AS "aliasType",
          value, source, confidence, confirmed,
          created_at AS "createdAt", updated_at AS "updatedAt"
      ),
      upd AS (
        UPDATE identity_alias
        SET value = ${data.value}, source = ${data.source}, confidence = ${confidence},
            confirmed = ${confirmed},
            membership_id = COALESCE(${membershipId}, identity_alias.membership_id),
            updated_at = now()
        WHERE id = (SELECT id FROM existing)
        RETURNING id, member_id AS "memberId", membership_id AS "membershipId",
          guild_id AS "guildId", alias_type AS "aliasType",
          value, source, confidence, confirmed,
          created_at AS "createdAt", updated_at AS "updatedAt"
      )
      SELECT * FROM ins UNION ALL SELECT * FROM upd
    `.execute(this.db);
    return rows[0];
  }

  async findByMember(
    memberId: string,
    opts?: { guildId?: string; aliasType?: AliasType },
  ): Promise<IdentityAlias[]> {
    let q = this.db.selectFrom('identity_alias').selectAll()
      .where('memberId', '=', memberId);
    if (opts?.guildId) {
      q = q.where((eb) => eb.or([
        eb('guildId', '=', opts.guildId!),
        eb('guildId', 'is', null),
      ]));
    }
    if (opts?.aliasType) q = q.where('aliasType', '=', opts.aliasType);
    return (await q.orderBy('confirmed', 'desc').orderBy('confidence', 'desc')
      .orderBy('updatedAt', 'desc').execute()).map(as_<IdentityAlias>);
  }

  async findConfirmedNames(memberId: string, guildId?: string): Promise<IdentityAlias[]> {
    let q = this.db.selectFrom('identity_alias').selectAll()
      .where('memberId', '=', memberId).where('confirmed', '=', true);
    if (guildId) {
      q = q.where((eb) => eb.or([
        eb('guildId', '=', guildId),
        eb('guildId', 'is', null),
      ]));
    }
    return (await q.orderBy('updatedAt', 'desc').execute()).map(as_<IdentityAlias>);
  }
}

// ── Action Outcomes ─────────────────────────────────────────────────

export class ActionOutcomeRepo {
  constructor(private db: Db) {}

  async create(data: {
    interactionId: string; guildId: string; actionType: string;
    targetMemberId?: string | null; targetMembershipId?: string | null;
    targetChannelId?: string | null; success: boolean;
    errorMessage?: string | null; metadata?: Record<string, unknown>;
  }): Promise<ActionOutcome> {
    const row = await this.db.insertInto('action_outcome')
      .values({
        interactionId: data.interactionId, guildId: data.guildId,
        actionType: data.actionType,
        targetMemberId: data.targetMemberId ?? null,
        targetMembershipId: data.targetMembershipId ?? null,
        targetChannelId: data.targetChannelId ?? null,
        success: data.success,
        errorMessage: data.errorMessage ?? null,
        metadata: JSON.stringify(data.metadata ?? {}),
      })
      .returningAll().executeTakeFirstOrThrow();
    return as_<ActionOutcome>(row);
  }

  async findByInteraction(interactionId: string): Promise<ActionOutcome[]> {
    return (await this.db.selectFrom('action_outcome').selectAll()
      .where('interactionId', '=', interactionId).orderBy('createdAt', 'asc').execute())
      .map(as_<ActionOutcome>);
  }

  async listByGuild(
    guildId: string, opts?: { actionType?: string; limit?: number },
  ): Promise<ActionOutcome[]> {
    let q = this.db.selectFrom('action_outcome').selectAll()
      .where('guildId', '=', guildId);
    if (opts?.actionType) q = q.where('actionType', '=', opts.actionType);
    return (await q.orderBy('createdAt', 'desc').limit(opts?.limit ?? 50).execute())
      .map(as_<ActionOutcome>);
  }
}

// ── Embeddings ──────────────────────────────────────────────────────

export class EmbeddingRepo {
  constructor(private db: Db) {}

  async store(data: {
    memoryRecordId: string; embedding: number[]; model: string;
  }): Promise<Embedding> {
    const vectorLiteral = `[${data.embedding.join(',')}]`;
    const { rows } = await sql<Embedding>`
      INSERT INTO embedding (memory_record_id, embedding, model)
      VALUES (${data.memoryRecordId}, ${vectorLiteral}::vector, ${data.model})
      ON CONFLICT (memory_record_id) DO UPDATE
        SET embedding = ${vectorLiteral}::vector, model = ${data.model}, created_at = now()
      RETURNING id, memory_record_id AS "memoryRecordId", model, created_at AS "createdAt"
    `.execute(this.db);
    return rows[0];
  }

  async findByMemoryRecordId(memoryRecordId: string): Promise<Embedding | null> {
    const row = await this.db.selectFrom('embedding')
      .select(['id', 'memoryRecordId', 'model', 'createdAt'])
      .where('memoryRecordId', '=', memoryRecordId).executeTakeFirst();
    return row ? as_<Embedding>(row) : null;
  }

  async deleteByMemoryRecordId(memoryRecordId: string): Promise<void> {
    await this.db.deleteFrom('embedding')
      .where('memoryRecordId', '=', memoryRecordId).execute();
  }
}

// ── Memory Retrieval (pgvector) ─────────────────────────────────────

export interface ScoredMemory extends MemoryRecord {
  score: number;
}

export interface MemoryRetrievalFilter {
  guildId: string;
  memberId?: string;
  capability?: string;
  category?: MemoryCategory;
  since?: Date;
  limit?: number;
}

export class MemoryRetrieval {
  constructor(private db: Db) {}

  async searchByVector(
    queryEmbedding: number[],
    filter: MemoryRetrievalFilter,
  ): Promise<ScoredMemory[]> {
    const vectorLiteral = `[${queryEmbedding.join(',')}]`;
    const where = this.buildWhere(filter);
    const lim = filter.limit ?? 20;

    const { rows } = await sql<ScoredMemory>`
      SELECT mr.id, mr.guild_id AS "guildId", mr.member_id AS "memberId",
             mr.membership_id AS "membershipId",
             mr.category, mr.content, mr.capability, mr.confidence,
             mr.source_interaction_id AS "sourceInteractionId",
             mr.expires_at AS "expiresAt",
             mr.created_at AS "createdAt", mr.updated_at AS "updatedAt",
             1 - (e.embedding <=> ${vectorLiteral}::vector) AS score
      FROM memory_record mr
      JOIN embedding e ON e.memory_record_id = mr.id
      WHERE ${where}
        AND e.embedding IS NOT NULL
      ORDER BY e.embedding <=> ${vectorLiteral}::vector ASC
      LIMIT ${lim}
    `.execute(this.db);
    return rows;
  }

  async searchByRecency(filter: MemoryRetrievalFilter): Promise<ScoredMemory[]> {
    const where = this.buildWhere(filter);
    const lim = filter.limit ?? 20;

    const { rows } = await sql<ScoredMemory>`
      SELECT mr.id, mr.guild_id AS "guildId", mr.member_id AS "memberId",
             mr.membership_id AS "membershipId",
             mr.category, mr.content, mr.capability, mr.confidence,
             mr.source_interaction_id AS "sourceInteractionId",
             mr.expires_at AS "expiresAt",
             mr.created_at AS "createdAt", mr.updated_at AS "updatedAt",
             mr.confidence AS score
      FROM memory_record mr
      WHERE ${where}
      ORDER BY mr.created_at DESC
      LIMIT ${lim}
    `.execute(this.db);
    return rows;
  }

  async searchHybrid(
    queryEmbedding: number[],
    filter: MemoryRetrievalFilter,
    opts?: { vectorWeight?: number; decayDays?: number },
  ): Promise<ScoredMemory[]> {
    const vw = opts?.vectorWeight ?? 0.7;
    const rw = 1 - vw;
    const decay = opts?.decayDays ?? 30;
    const vectorLiteral = `[${queryEmbedding.join(',')}]`;
    const where = this.buildWhere(filter);
    const lim = filter.limit ?? 20;

    const { rows } = await sql<ScoredMemory>`
      SELECT mr.id, mr.guild_id AS "guildId", mr.member_id AS "memberId",
             mr.membership_id AS "membershipId",
             mr.category, mr.content, mr.capability, mr.confidence,
             mr.source_interaction_id AS "sourceInteractionId",
             mr.expires_at AS "expiresAt",
             mr.created_at AS "createdAt", mr.updated_at AS "updatedAt",
             (
               ${vw}::real * (1 - (e.embedding <=> ${vectorLiteral}::vector))
               + ${rw}::real * EXP(-EXTRACT(EPOCH FROM (now() - mr.created_at)) / (86400.0 * ${decay}::real))
             ) AS score
      FROM memory_record mr
      JOIN embedding e ON e.memory_record_id = mr.id
      WHERE ${where}
        AND e.embedding IS NOT NULL
      ORDER BY score DESC
      LIMIT ${lim}
    `.execute(this.db);
    return rows;
  }

  /** Build a SQL fragment for the common WHERE conditions. */
  private buildWhere(filter: MemoryRetrievalFilter) {
    const parts = [
      sql`mr.guild_id = ${filter.guildId}`,
      sql`(mr.expires_at IS NULL OR mr.expires_at > now())`,
    ];
    if (filter.memberId) parts.push(sql`mr.member_id = ${filter.memberId}`);
    if (filter.capability) parts.push(sql`mr.capability = ${filter.capability}`);
    if (filter.category) parts.push(sql`mr.category = ${filter.category}`);
    if (filter.since) parts.push(sql`mr.created_at >= ${filter.since}`);
    return sql.join(parts, sql` AND `);
  }
}
