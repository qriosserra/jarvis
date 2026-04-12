import type { Pool } from 'pg';
import type { Member } from '../types.js';

export class MemberRepo {
  constructor(private pool: Pool) {}

  async upsert(data: {
    id: string;
    guildId: string;
    username: string;
    displayName?: string | null;
  }): Promise<Member> {
    const { rows } = await this.pool.query<Member>(
      `INSERT INTO members (id, guild_id, username, display_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id, guild_id) DO UPDATE
         SET username = $3, display_name = COALESCE($4, members.display_name), updated_at = now()
       RETURNING id, guild_id AS "guildId", username, display_name AS "displayName",
                 joined_at AS "joinedAt", updated_at AS "updatedAt"`,
      [data.id, data.guildId, data.username, data.displayName ?? null],
    );
    return rows[0];
  }

  async findByGuildAndId(guildId: string, memberId: string): Promise<Member | null> {
    const { rows } = await this.pool.query<Member>(
      `SELECT id, guild_id AS "guildId", username, display_name AS "displayName",
              joined_at AS "joinedAt", updated_at AS "updatedAt"
       FROM members WHERE guild_id = $1 AND id = $2`,
      [guildId, memberId],
    );
    return rows[0] ?? null;
  }

  async listByGuild(guildId: string): Promise<Member[]> {
    const { rows } = await this.pool.query<Member>(
      `SELECT id, guild_id AS "guildId", username, display_name AS "displayName",
              joined_at AS "joinedAt", updated_at AS "updatedAt"
       FROM members WHERE guild_id = $1 ORDER BY username`,
      [guildId],
    );
    return rows;
  }
}
