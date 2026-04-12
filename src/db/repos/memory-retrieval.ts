import type { Pool } from 'pg';
import type { MemoryRecord, MemoryCategory } from '../types.js';

/** A memory record returned by hybrid retrieval, annotated with a relevance score. */
export interface ScoredMemory extends MemoryRecord {
  score: number;
}

/** Filter options for hybrid memory retrieval. */
export interface MemoryRetrievalFilter {
  guildId: string;
  memberId?: string;
  capability?: string;
  category?: MemoryCategory;
  /** Only include records created after this date. */
  since?: Date;
  /** Maximum number of results. Default 20. */
  limit?: number;
}

/**
 * Hybrid memory retrieval combining pgvector cosine similarity with metadata filters.
 *
 * When an embedding query vector is provided, results are ranked by cosine similarity.
 * When no vector is provided, results are ranked by recency (created_at DESC).
 * Metadata filters (guild, member, capability, category, recency) always apply.
 */
export class MemoryRetrieval {
  constructor(private pool: Pool) {}

  /**
   * Retrieve memories using vector similarity plus metadata filters.
   * The query embedding must have the same dimensionality as stored embeddings.
   */
  async searchByVector(
    queryEmbedding: number[],
    filter: MemoryRetrievalFilter,
  ): Promise<ScoredMemory[]> {
    const vectorLiteral = `[${queryEmbedding.join(',')}]`;
    const { conditions, params, idx } = this.buildFilters(filter);

    // Cosine distance → similarity: 1 - distance
    const { rows } = await this.pool.query<ScoredMemory>(
      `SELECT mr.id, mr.guild_id AS "guildId", mr.member_id AS "memberId",
              mr.membership_id AS "membershipId",
              mr.category, mr.content, mr.capability, mr.confidence,
              mr.source_interaction_id AS "sourceInteractionId",
              mr.expires_at AS "expiresAt",
              mr.created_at AS "createdAt", mr.updated_at AS "updatedAt",
              1 - (e.embedding <=> $${idx}::vector) AS score
       FROM memory_records mr
       JOIN embeddings e ON e.memory_record_id = mr.id
       WHERE ${conditions.join(' AND ')}
         AND e.embedding IS NOT NULL
       ORDER BY e.embedding <=> $${idx}::vector ASC
       LIMIT ${filter.limit ?? 20}`,
      [...params, vectorLiteral],
    );
    return rows;
  }

  /**
   * Retrieve memories using metadata filters only, ranked by recency.
   * Useful when no embedding query is available.
   */
  async searchByRecency(filter: MemoryRetrievalFilter): Promise<ScoredMemory[]> {
    const { conditions, params } = this.buildFilters(filter);

    const { rows } = await this.pool.query<ScoredMemory>(
      `SELECT mr.id, mr.guild_id AS "guildId", mr.member_id AS "memberId",
              mr.membership_id AS "membershipId",
              mr.category, mr.content, mr.capability, mr.confidence,
              mr.source_interaction_id AS "sourceInteractionId",
              mr.expires_at AS "expiresAt",
              mr.created_at AS "createdAt", mr.updated_at AS "updatedAt",
              mr.confidence AS score
       FROM memory_records mr
       WHERE ${conditions.join(' AND ')}
       ORDER BY mr.created_at DESC
       LIMIT ${filter.limit ?? 20}`,
      params,
    );
    return rows;
  }

  /**
   * Hybrid search: combine vector similarity and recency into a blended score.
   * score = (vectorWeight * cosineSimilarity) + ((1 - vectorWeight) * recencyScore)
   * recencyScore decays exponentially over `decayDays`.
   */
  async searchHybrid(
    queryEmbedding: number[],
    filter: MemoryRetrievalFilter,
    opts?: { vectorWeight?: number; decayDays?: number },
  ): Promise<ScoredMemory[]> {
    const vectorWeight = opts?.vectorWeight ?? 0.7;
    const decayDays = opts?.decayDays ?? 30;
    const vectorLiteral = `[${queryEmbedding.join(',')}]`;
    const { conditions, params, idx } = this.buildFilters(filter);

    const { rows } = await this.pool.query<ScoredMemory>(
      `SELECT mr.id, mr.guild_id AS "guildId", mr.member_id AS "memberId",
              mr.membership_id AS "membershipId",
              mr.category, mr.content, mr.capability, mr.confidence,
              mr.source_interaction_id AS "sourceInteractionId",
              mr.expires_at AS "expiresAt",
              mr.created_at AS "createdAt", mr.updated_at AS "updatedAt",
              (
                $${idx + 1}::real * (1 - (e.embedding <=> $${idx}::vector))
                + $${idx + 2}::real * EXP(-EXTRACT(EPOCH FROM (now() - mr.created_at)) / (86400.0 * $${idx + 3}::real))
              ) AS score
       FROM memory_records mr
       JOIN embeddings e ON e.memory_record_id = mr.id
       WHERE ${conditions.join(' AND ')}
         AND e.embedding IS NOT NULL
       ORDER BY score DESC
       LIMIT ${filter.limit ?? 20}`,
      [...params, vectorLiteral, vectorWeight, 1 - vectorWeight, decayDays],
    );
    return rows;
  }

  private buildFilters(filter: MemoryRetrievalFilter): {
    conditions: string[];
    params: unknown[];
    idx: number;
  } {
    const conditions = [
      'mr.guild_id = $1',
      '(mr.expires_at IS NULL OR mr.expires_at > now())',
    ];
    const params: unknown[] = [filter.guildId];
    let idx = 2;

    if (filter.memberId) {
      conditions.push(`mr.member_id = $${idx++}`);
      params.push(filter.memberId);
    }
    if (filter.capability) {
      conditions.push(`mr.capability = $${idx++}`);
      params.push(filter.capability);
    }
    if (filter.category) {
      conditions.push(`mr.category = $${idx++}`);
      params.push(filter.category);
    }
    if (filter.since) {
      conditions.push(`mr.created_at >= $${idx++}`);
      params.push(filter.since);
    }

    return { conditions, params, idx };
  }
}
