import type { Pool } from 'pg';
import type { Embedding } from '../types.js';

const COLUMNS = `id, memory_record_id AS "memoryRecordId", model, created_at AS "createdAt"`;

export class EmbeddingRepo {
  constructor(private pool: Pool) {}

  async store(data: {
    memoryRecordId: string;
    embedding: number[];
    model: string;
  }): Promise<Embedding> {
    const vectorLiteral = `[${data.embedding.join(',')}]`;
    const { rows } = await this.pool.query<Embedding>(
      `INSERT INTO embeddings (memory_record_id, embedding, model)
       VALUES ($1, $2::vector, $3)
       ON CONFLICT (memory_record_id) DO UPDATE
         SET embedding = $2::vector, model = $3, created_at = now()
       RETURNING ${COLUMNS}`,
      [data.memoryRecordId, vectorLiteral, data.model],
    );
    return rows[0];
  }

  async findByMemoryRecordId(memoryRecordId: string): Promise<Embedding | null> {
    const { rows } = await this.pool.query<Embedding>(
      `SELECT ${COLUMNS} FROM embeddings WHERE memory_record_id = $1`,
      [memoryRecordId],
    );
    return rows[0] ?? null;
  }

  async deleteByMemoryRecordId(memoryRecordId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM embeddings WHERE memory_record_id = $1`,
      [memoryRecordId],
    );
  }
}
