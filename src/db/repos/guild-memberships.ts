import type { Pool } from 'pg';
import type { GuildMembership } from '../types.js';

const COLUMNS = `id, guild_id AS "guildId", user_id AS "userId",
  display_name AS "displayName", created_at AS "createdAt", updated_at AS "updatedAt"`;

export class GuildMembershipRepo {
  constructor(private pool: Pool) {}

  /**
   * Upsert a guild membership row. Returns the membership including its
   * stable UUID, which should be threaded through all downstream writes.
   */
  async upsert(data: {
    guildId: string;
    userId: string;
    displayName?: string | null;
  }): Promise<GuildMembership> {
    const { rows } = await this.pool.query<GuildMembership>(
      `INSERT INTO guild_membership (guild_id, user_id, display_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (guild_id, user_id) DO UPDATE
         SET display_name = COALESCE($3, guild_membership.display_name),
             updated_at = now()
       RETURNING ${COLUMNS}`,
      [data.guildId, data.userId, data.displayName ?? null],
    );
    return rows[0];
  }

  async findByGuildAndUser(guildId: string, userId: string): Promise<GuildMembership | null> {
    const { rows } = await this.pool.query<GuildMembership>(
      `SELECT ${COLUMNS} FROM guild_membership
       WHERE guild_id = $1 AND user_id = $2`,
      [guildId, userId],
    );
    return rows[0] ?? null;
  }

  async findById(id: string): Promise<GuildMembership | null> {
    const { rows } = await this.pool.query<GuildMembership>(
      `SELECT ${COLUMNS} FROM guild_membership WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async listByGuild(guildId: string): Promise<GuildMembership[]> {
    const { rows } = await this.pool.query<GuildMembership>(
      `SELECT ${COLUMNS} FROM guild_membership
       WHERE guild_id = $1
       ORDER BY created_at`,
      [guildId],
    );
    return rows;
  }

  async listByUser(userId: string): Promise<GuildMembership[]> {
    const { rows } = await this.pool.query<GuildMembership>(
      `SELECT ${COLUMNS} FROM guild_membership
       WHERE user_id = $1
       ORDER BY created_at`,
      [userId],
    );
    return rows;
  }
}
