import type { Pool } from 'pg';
import type { OperationLatency, OperationStatus } from '../types.js';

const COLUMNS = `id, interaction_id AS "interactionId", correlation_id AS "correlationId",
  guild_id AS "guildId", member_id AS "memberId", membership_id AS "membershipId",
  operation_name AS "operationName",
  operation_type AS "operationType", parent_operation_id AS "parentOperationId",
  provider_name AS "providerName", model, status, duration_ms AS "durationMs",
  started_at AS "startedAt", metadata, created_at AS "createdAt"`;

export interface CreateOperationLatencyData {
  id?: string | null;
  interactionId?: string | null;
  correlationId?: string | null;
  guildId?: string | null;
  memberId?: string | null;
  membershipId?: string | null;
  operationName: string;
  operationType: string;
  parentOperationId?: string | null;
  providerName?: string | null;
  model?: string | null;
  status: OperationStatus;
  durationMs?: number | null;
  startedAt: Date;
  metadata?: Record<string, unknown>;
}

export class OperationLatencyRepo {
  constructor(private pool: Pool) {}

  async create(data: CreateOperationLatencyData): Promise<OperationLatency> {
    const { rows } = await this.pool.query<OperationLatency>(
      `INSERT INTO operation_latencies (
        id, interaction_id, correlation_id, guild_id, member_id, membership_id,
        operation_name, operation_type, parent_operation_id,
        provider_name, model, status, duration_ms, started_at, metadata
      ) VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING ${COLUMNS}`,
      [
        data.id ?? null,
        data.interactionId ?? null,
        data.correlationId ?? null,
        data.guildId ?? null,
        data.memberId ?? null,
        data.membershipId ?? null,
        data.operationName,
        data.operationType,
        data.parentOperationId ?? null,
        data.providerName ?? null,
        data.model ?? null,
        data.status,
        data.durationMs ?? null,
        data.startedAt,
        JSON.stringify(data.metadata ?? {}),
      ],
    );
    return rows[0];
  }

  async finalize(
    id: string,
    status: OperationStatus,
    durationMs: number,
    extra?: { providerName?: string | null; model?: string | null; metadata?: Record<string, unknown> },
  ): Promise<void> {
    const sets = ['status = $2', 'duration_ms = $3'];
    const params: unknown[] = [id, status, durationMs];
    let idx = 4;

    if (extra?.providerName !== undefined) {
      sets.push(`provider_name = $${idx}`);
      params.push(extra.providerName);
      idx++;
    }
    if (extra?.model !== undefined) {
      sets.push(`model = $${idx}`);
      params.push(extra.model);
      idx++;
    }
    if (extra?.metadata !== undefined) {
      sets.push(`metadata = $${idx}`);
      params.push(JSON.stringify(extra.metadata));
      idx++;
    }

    await this.pool.query(
      `UPDATE operation_latencies SET ${sets.join(', ')} WHERE id = $1`,
      params,
    );
  }
}
