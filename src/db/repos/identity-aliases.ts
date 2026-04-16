import type { Pool } from 'pg';
import type { IdentityAlias, AliasType, AliasSource } from '../types.js';

const COLUMNS = `id, member_id AS "memberId", membership_id AS "membershipId",
  guild_id AS "guildId", alias_type AS "aliasType",
  value, source, confidence, confirmed, created_at AS "createdAt", updated_at AS "updatedAt"`;

export class IdentityAliasRepo {
  constructor(private pool: Pool) {}

  async upsert(data: {
    memberId: string;
    membershipId?: string | null;
    guildId?: string | null;
    aliasType: AliasType;
    value: string;
    source: AliasSource;
    confidence?: number;
    confirmed?: boolean;
  }): Promise<IdentityAlias> {
    const guildId = data.guildId ?? null;
    const membershipId = data.membershipId ?? null;
    const confidence = data.confidence ?? 1.0;
    const confirmed = data.confirmed ?? false;

    const { rows } = await this.pool.query<IdentityAlias>(
      `WITH existing AS (
         SELECT id FROM identity_alias
         WHERE member_id = $1
           AND COALESCE(guild_id, '__global__') = COALESCE($2, '__global__')
           AND alias_type = $3
       ),
       ins AS (
         INSERT INTO identity_alias (member_id, guild_id, alias_type, value, source, confidence, confirmed, membership_id)
         SELECT $1, $2, $3, $4, $5, $6, $7, $8
         WHERE NOT EXISTS (SELECT 1 FROM existing)
         RETURNING ${COLUMNS}
       ),
       upd AS (
         UPDATE identity_alias
         SET value = $4, source = $5, confidence = $6, confirmed = $7, membership_id = COALESCE($8, identity_alias.membership_id), updated_at = now()
         WHERE id = (SELECT id FROM existing)
         RETURNING ${COLUMNS}
       )
       SELECT * FROM ins UNION ALL SELECT * FROM upd`,
      [data.memberId, guildId, data.aliasType, data.value, data.source, confidence, confirmed, membershipId],
    );
    return rows[0];
  }

  async findByMember(
    memberId: string,
    opts?: { guildId?: string; aliasType?: AliasType },
  ): Promise<IdentityAlias[]> {
    const conditions = ['member_id = $1'];
    const params: unknown[] = [memberId];
    let idx = 2;

    if (opts?.guildId) {
      conditions.push(`(guild_id = $${idx} OR guild_id IS NULL)`);
      params.push(opts.guildId);
      idx++;
    }
    if (opts?.aliasType) {
      conditions.push(`alias_type = $${idx++}`);
      params.push(opts.aliasType);
    }

    const { rows } = await this.pool.query<IdentityAlias>(
      `SELECT ${COLUMNS} FROM identity_alias
       WHERE ${conditions.join(' AND ')}
       ORDER BY confirmed DESC, confidence DESC, updated_at DESC`,
      params,
    );
    return rows;
  }

  async findConfirmedNames(memberId: string, guildId?: string): Promise<IdentityAlias[]> {
    const conditions = ['member_id = $1', 'confirmed = true'];
    const params: unknown[] = [memberId];

    if (guildId) {
      conditions.push(`(guild_id = $2 OR guild_id IS NULL)`);
      params.push(guildId);
    }

    const { rows } = await this.pool.query<IdentityAlias>(
      `SELECT ${COLUMNS} FROM identity_alias
       WHERE ${conditions.join(' AND ')}
       ORDER BY updated_at DESC`,
      params,
    );
    return rows;
  }
}
