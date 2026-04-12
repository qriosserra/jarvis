import type { Pool } from 'pg';
import type { Guild } from '../types.js';

export class GuildRepo {
  constructor(private pool: Pool) {}

  async upsert(data: { id: string; name: string; settings?: Record<string, unknown> }): Promise<Guild> {
    const { rows } = await this.pool.query<Guild>(
      `INSERT INTO guilds (id, name, settings)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET name = $2, settings = COALESCE($3, guilds.settings), updated_at = now()
       RETURNING id, name, joined_at AS "joinedAt", settings, updated_at AS "updatedAt"`,
      [data.id, data.name, JSON.stringify(data.settings ?? {})],
    );
    return rows[0];
  }

  async findById(id: string): Promise<Guild | null> {
    const { rows } = await this.pool.query<Guild>(
      `SELECT id, name, joined_at AS "joinedAt", settings, updated_at AS "updatedAt"
       FROM guilds WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async list(): Promise<Guild[]> {
    const { rows } = await this.pool.query<Guild>(
      `SELECT id, name, joined_at AS "joinedAt", settings, updated_at AS "updatedAt"
       FROM guilds ORDER BY joined_at`,
    );
    return rows;
  }
}
