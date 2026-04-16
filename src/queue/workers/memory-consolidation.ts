import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Kysely } from 'kysely';
import { createLogger } from '../../lib/logger.js';
import { QUEUE_NAMES, type MemoryConsolidationJobData } from '../definitions.js';
import { MemoryRecordRepo } from '../../db/repos.js';
import type { Database } from '../../db/kysely.js';
import { queueJobCounter, queueJobDuration } from '../../lib/metrics.js';
import { trackOperation } from '../../lib/latency-tracker.js';
import { OperationName, OperationType, OperationMetadata } from '../../lib/operation-constants.js';

const logger = createLogger('worker:memory-consolidation');

export interface MemoryConsolidationWorkerDeps {
  redis: Redis;
  db: Kysely<Database>;
}

/**
 * Worker that performs non-latency-critical memory maintenance:
 * - Deletes expired memory records
 * - Future: merge redundant memories, decay confidence, etc.
 */
export function startMemoryConsolidationWorker(
  deps: MemoryConsolidationWorkerDeps,
): Worker<MemoryConsolidationJobData> {
  const repo = new MemoryRecordRepo(deps.db);

  const worker = new Worker<MemoryConsolidationJobData>(
    QUEUE_NAMES.MEMORY_CONSOLIDATION,
    async (job: Job<MemoryConsolidationJobData>) => {
      const startMs = Date.now();
      const { guildId, memberId } = job.data;
      logger.info({ guildId, memberId, jobId: job.id }, 'Running memory consolidation');

      // Phase 1: clean up expired records
      const { result: deleted } = await trackOperation(
        {
          operationName: OperationName.MEMORY_DELETE_EXPIRED,
          operationType: OperationType.DB,
          context: { guildId, memberId },
          metadata: { queue: OperationMetadata.Queue.MEMORY_CONSOLIDATION },
        },
        () => repo.deleteExpired(),
      );
      if (deleted > 0) {
        logger.info({ deleted }, 'Expired memory records removed');
      }

      // Phase 2: placeholder for future consolidation logic
      // e.g. merge overlapping summaries, decay low-confidence records
      queueJobCounter.add(1, { queue: 'memory-consolidation', status: 'completed' });
      queueJobDuration.record(Date.now() - startMs, { queue: 'memory-consolidation' });
      logger.info({ guildId, memberId }, 'Memory consolidation complete');
    },
    {
      connection: deps.redis,
      concurrency: 2,
    },
  );

  worker.on('failed', (job, err) => {
    queueJobCounter.add(1, { queue: 'memory-consolidation', status: 'failed' });
    logger.error({ jobId: job?.id, err }, 'Memory consolidation failed');
  });

  worker.on('error', (err) => {
    logger.error({ err }, 'Memory consolidation worker error');
  });

  return worker;
}
