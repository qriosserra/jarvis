import type { Pool } from 'pg';
import type { MemoryRecord, MemoryCategory } from '../types.js';

const COLUMNS = `id, guild_id AS "guildId", member_id AS "memberId",
  membership_id AS "membershipId", category, content,
  capability, confidence, source_interaction_id AS "sourceInteractionId",
  expires_at AS "expiresAt", created_at AS "createdAt", updated_at AS "updatedAt"`;

export class MemoryRecordRepo {
  constructor(private pool: Pool) {}

  async create(data: {
    guildId: string;
    memberId?: string | null;
    membershipId?: string | null;
    category: MemoryCategory;
    content: string;
    capability?: string | null;
    confidence?: number;
    sourceInteractionId?: string | null;
    expiresAt?: Date | null;
  }): Promise<MemoryRecord> {
    const { rows } = await this.pool.query<MemoryRecord>(
      `INSERT INTO memory_records (guild_id, member_id, membership_id, category, content,
                                   capability, confidence, source_interaction_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${COLUMNS}`,
      [
        data.guildId,
        data.memberId ?? null,
        data.membershipId ?? null,
        data.category,
        data.content,
        data.capability ?? null,
        data.confidence ?? 1.0,
        data.sourceInteractionId ?? null,
        data.expiresAt ?? null,
      ],
    );
    return rows[0];
  }

  async findById(id: string): Promise<MemoryRecord | null> {
    const { rows } = await this.pool.query<MemoryRecord>(
      `SELECT ${COLUMNS} FROM memory_records WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async listByGuild(
    guildId: string,
    opts?: {
      memberId?: string;
      category?: MemoryCategory;
      capability?: string;
      limit?: number;
    },
  ): Promise<MemoryRecord[]> {
    const conditions = ['guild_id = $1', '(expires_at IS NULL OR expires_at > now())'];
    const params: unknown[] = [guildId];
    let idx = 2;

    if (opts?.memberId) {
      conditions.push(`member_id = $${idx++}`);
      params.push(opts.memberId);
    }
    if (opts?.category) {
      conditions.push(`category = $${idx++}`);
      params.push(opts.category);
    }
    if (opts?.capability) {
      conditions.push(`capability = $${idx++}`);
      params.push(opts.capability);
    }

    const limit = opts?.limit ?? 50;

    const { rows } = await this.pool.query<MemoryRecord>(
      `SELECT ${COLUMNS} FROM memory_records
       WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT ${limit}`,
      params,
    );
    return rows;
  }

  async updateConfidence(id: string, confidence: number): Promise<void> {
    await this.pool.query(
      `UPDATE memory_records SET confidence = $2, updated_at = now() WHERE id = $1`,
      [id, confidence],
    );
  }

  async deleteExpired(): Promise<number> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM memory_records WHERE expires_at IS NOT NULL AND expires_at <= now()`,
    );
    return rowCount ?? 0;
  }
}
