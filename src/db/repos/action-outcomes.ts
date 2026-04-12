import type { Pool } from 'pg';
import type { ActionOutcome } from '../types.js';

const COLUMNS = `id, interaction_id AS "interactionId", guild_id AS "guildId",
  action_type AS "actionType", target_member_id AS "targetMemberId",
  target_membership_id AS "targetMembershipId",
  target_channel_id AS "targetChannelId", success, error_message AS "errorMessage",
  metadata, created_at AS "createdAt"`;

export class ActionOutcomeRepo {
  constructor(private pool: Pool) {}

  async create(data: {
    interactionId: string;
    guildId: string;
    actionType: string;
    targetMemberId?: string | null;
    targetMembershipId?: string | null;
    targetChannelId?: string | null;
    success: boolean;
    errorMessage?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<ActionOutcome> {
    const { rows } = await this.pool.query<ActionOutcome>(
      `INSERT INTO action_outcomes (interaction_id, guild_id, action_type,
                                    target_member_id, target_membership_id,
                                    target_channel_id,
                                    success, error_message, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${COLUMNS}`,
      [
        data.interactionId,
        data.guildId,
        data.actionType,
        data.targetMemberId ?? null,
        data.targetMembershipId ?? null,
        data.targetChannelId ?? null,
        data.success,
        data.errorMessage ?? null,
        JSON.stringify(data.metadata ?? {}),
      ],
    );
    return rows[0];
  }

  async findByInteraction(interactionId: string): Promise<ActionOutcome[]> {
    const { rows } = await this.pool.query<ActionOutcome>(
      `SELECT ${COLUMNS} FROM action_outcomes WHERE interaction_id = $1
       ORDER BY created_at`,
      [interactionId],
    );
    return rows;
  }

  async listByGuild(
    guildId: string,
    opts?: { actionType?: string; limit?: number },
  ): Promise<ActionOutcome[]> {
    const conditions = ['guild_id = $1'];
    const params: unknown[] = [guildId];
    let idx = 2;

    if (opts?.actionType) {
      conditions.push(`action_type = $${idx++}`);
      params.push(opts.actionType);
    }

    const limit = opts?.limit ?? 50;

    const { rows } = await this.pool.query<ActionOutcome>(
      `SELECT ${COLUMNS} FROM action_outcomes
       WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT ${limit}`,
      params,
    );
    return rows;
  }
}
