import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Kysely } from 'kysely';
import { createLogger } from '../../lib/logger.js';
import { QUEUE_NAMES, type EmbeddingJobData } from '../definitions.js';
import { EmbeddingRepo } from '../../db/repos.js';
import type { Database } from '../../db/kysely.js';
import type { EmbeddingProvider } from '../../providers/types.js';
import { queueJobCounter, queueJobDuration } from '../../lib/metrics.js';
import { trackOperation } from '../../lib/latency-tracker.js';

const logger = createLogger('worker:embedding-generation');

export interface EmbeddingWorkerDeps {
  redis: Redis;
  db: Kysely<Database>;
  embeddingProvider: EmbeddingProvider;
  embeddingModel?: string;
}

export function startEmbeddingWorker(deps: EmbeddingWorkerDeps): Worker<EmbeddingJobData> {
  const repo = new EmbeddingRepo(deps.db);
  let dimensionLogged = false;

  const worker = new Worker<EmbeddingJobData>(
    QUEUE_NAMES.EMBEDDING_GENERATION,
    async (job: Job<EmbeddingJobData>) => {
      const startMs = Date.now();
      const { memoryRecordId, content } = job.data;
      logger.info({ memoryRecordId, jobId: job.id }, 'Generating embedding');

      const { result } = await trackOperation(
        {
          operationName: 'embedding_document',
          operationType: 'embedding',
          providerName: deps.embeddingProvider.name,
          model: deps.embeddingModel,
          metadata: { inputType: 'document', memoryRecordId, queue: 'embedding-generation' },
        },
        () => deps.embeddingProvider.embed(content, { model: deps.embeddingModel, inputType: 'document' }),
      );

      if (!dimensionLogged) {
        logger.info(
          { model: result.model, dimensions: result.embedding.length },
          'First embedding generated — vector dimension confirmed',
        );
        dimensionLogged = true;
      }

      await repo.store({
        memoryRecordId,
        embedding: result.embedding,
        model: result.model,
      });

      queueJobCounter.add(1, { queue: 'embedding-generation', status: 'completed' });
      queueJobDuration.record(Date.now() - startMs, { queue: 'embedding-generation' });
      logger.info({ memoryRecordId, model: result.model }, 'Embedding stored');
    },
    {
      connection: deps.redis,
      concurrency: 5,
      limiter: { max: 50, duration: 60_000 },
    },
  );

  worker.on('failed', (job, err) => {
    queueJobCounter.add(1, { queue: 'embedding-generation', status: 'failed' });
    logger.error({ jobId: job?.id, err }, 'Embedding generation failed');
  });

  worker.on('error', (err) => {
    logger.error({ err }, 'Embedding worker error');
  });

  return worker;
}
