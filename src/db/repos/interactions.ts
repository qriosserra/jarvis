import type { Pool } from 'pg';
import type { Interaction, Surface } from '../types.js';

const COLUMNS = `id, guild_id AS "guildId", member_id AS "memberId",
  membership_id AS "membershipId", channel_id AS "channelId",
  surface, request_text AS "requestText", response_text AS "responseText",
  persona_id AS "personaId", language, correlation_id AS "correlationId",
  created_at AS "createdAt"`;

export class InteractionRepo {
  constructor(private pool: Pool) {}

  async create(data: {
    guildId: string;
    memberId: string;
    membershipId?: string | null;
    channelId: string;
    surface: Surface;
    requestText: string;
    responseText?: string | null;
    personaId?: string | null;
    language?: string | null;
    correlationId?: string | null;
  }): Promise<Interaction> {
    const { rows } = await this.pool.query<Interaction>(
      `INSERT INTO interactions (guild_id, member_id, membership_id, channel_id, surface,
                                 request_text, response_text, persona_id, language, correlation_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING ${COLUMNS}`,
      [
        data.guildId,
        data.memberId,
        data.membershipId ?? null,
        data.channelId,
        data.surface,
        data.requestText,
        data.responseText ?? null,
        data.personaId ?? null,
        data.language ?? null,
        data.correlationId ?? null,
      ],
    );
    return rows[0];
  }

  async updateResponse(id: string, responseText: string): Promise<void> {
    await this.pool.query(
      `UPDATE interactions SET response_text = $2 WHERE id = $1`,
      [id, responseText],
    );
  }

  async update(id: string, data: {
    responseText?: string | null;
    personaId?: string | null;
    language?: string | null;
  }): Promise<void> {
    const sets: string[] = [];
    const vals: unknown[] = [id];
    let idx = 2;

    if (data.responseText !== undefined) { sets.push(`response_text = $${idx++}`); vals.push(data.responseText); }
    if (data.personaId !== undefined) { sets.push(`persona_id = $${idx++}`); vals.push(data.personaId); }
    if (data.language !== undefined) { sets.push(`language = $${idx++}`); vals.push(data.language); }

    if (sets.length === 0) return;
    await this.pool.query(`UPDATE interactions SET ${sets.join(', ')} WHERE id = $1`, vals);
  }

  async findById(id: string): Promise<Interaction | null> {
    const { rows } = await this.pool.query<Interaction>(
      `SELECT ${COLUMNS} FROM interactions WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async listByGuild(
    guildId: string,
    opts?: { memberId?: string; limit?: number; before?: Date },
  ): Promise<Interaction[]> {
    const conditions = ['guild_id = $1'];
    const params: unknown[] = [guildId];
    let idx = 2;

    if (opts?.memberId) {
      conditions.push(`member_id = $${idx++}`);
      params.push(opts.memberId);
    }
    if (opts?.before) {
      conditions.push(`created_at < $${idx++}`);
      params.push(opts.before);
    }

    const limit = opts?.limit ?? 50;
    conditions.push(`TRUE`); // no-op placeholder for simpler query building

    const { rows } = await this.pool.query<Interaction>(
      `SELECT ${COLUMNS} FROM interactions
       WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT ${limit}`,
      params,
    );
    return rows;
  }
}
