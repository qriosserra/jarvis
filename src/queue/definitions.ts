import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

// ── Job data shapes ───────────────────────────────────────────────────

export interface EmbeddingJobData {
  memoryRecordId: string;
  content: string;
  guildId: string;
}

export interface MemoryConsolidationJobData {
  guildId: string;
  memberId?: string;
}

// ── Queue names ───────────────────────────────────────────────────────

export const QUEUE_NAMES = {
  EMBEDDING_GENERATION: 'embedding-generation',
  MEMORY_CONSOLIDATION: 'memory-consolidation',
} as const;

// ── Queue factory ─────────────────────────────────────────────────────

export function createQueues(redis: Redis) {
  const embeddingGeneration = new Queue<EmbeddingJobData>(
    QUEUE_NAMES.EMBEDDING_GENERATION,
    {
      connection: redis,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    },
  );

  const memoryConsolidation = new Queue<MemoryConsolidationJobData>(
    QUEUE_NAMES.MEMORY_CONSOLIDATION,
    {
      connection: redis,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 2000 },
      },
    },
  );

  return { embeddingGeneration, memoryConsolidation };
}

export type Queues = ReturnType<typeof createQueues>;
