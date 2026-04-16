import { Pool } from 'pg';
import type { Kysely } from 'kysely';
import { Redis as IORedis } from 'ioredis';
import { createLogger } from './lib/logger.js';
import { initTracer, shutdownTracer } from './lib/tracer.js';
import { loadConfig, type AppConfig } from './config/env.js';
import { setContainer, type Container } from './container.js';
import { runMigrations } from './db/migrate.js';
import { createDb, type Database } from './db/kysely.js';
import {
  GuildRepo,
  MemberRepo,
  UserRepo,
  GuildMembershipRepo,
  PersonaRepo,
  InteractionRepo,
  MemoryRecordRepo,
  IdentityAliasRepo,
  ActionOutcomeRepo,
  EmbeddingRepo,
  OperationLogRepo,
  MemoryRetrieval,
} from './db/repos.js';
import { createQueues } from './queue/definitions.js';
import { startEmbeddingWorker } from './queue/workers/embedding-generation.js';
import { startMemoryConsolidationWorker } from './queue/workers/memory-consolidation.js';
import { createProviderRouter } from './providers/router.js';
import type { ProviderRegistry } from './providers/router.js';
import { validateProviderConfig } from './providers/validation.js';
import { createXaiLlmProvider, createXaiEmbeddingProvider } from './providers/xai.js';
import { createVoyageEmbeddingProvider } from './providers/voyage.js';
import { setLatencyRepoAccessor } from './lib/latency-tracker.js';

const logger = createLogger('bootstrap');

export interface BootstrapResult {
  config: AppConfig;
  container: Container;
  db: Kysely<Database>;
  redis: IORedis;
  shutdown: () => Promise<void>;
}

/**
 * Initialise the non-Discord application infrastructure:
 * config, tracing, DB, Redis, repos, providers, queues, and workers.
 *
 * Returns a fully wired container (with `discord` left undefined)
 * and a `shutdown` helper for graceful teardown.
 */
export async function bootstrap(): Promise<BootstrapResult> {
  logger.info('Jarvis bootstrapping…');

  initTracer();

  const config = loadConfig();
  logger.info('Configuration validated');

  // Database — raw Pool for legacy migration runner, Kysely for everything else
  const pool = new Pool({ connectionString: config.database.url });
  await pool.query('SELECT 1');
  logger.info('PostgreSQL connected');

  // Run migrations (still uses raw Pool)
  await runMigrations(pool);
  logger.info('Database migrations complete');

  // Kysely instance (primary DB access)
  const db = createDb(config.database.url);

  // Redis
  const redis = new IORedis(config.redis.url, { maxRetriesPerRequest: null });
  await redis.ping();
  logger.info('Redis connected');

  // Repositories — all backed by Kysely
  const repos = {
    guilds: new GuildRepo(db),
    members: new MemberRepo(db),
    users: new UserRepo(db),
    guildMemberships: new GuildMembershipRepo(db),
    personas: new PersonaRepo(db),
    interactions: new InteractionRepo(db),
    memoryRecords: new MemoryRecordRepo(db),
    identityAliases: new IdentityAliasRepo(db),
    actionOutcomes: new ActionOutcomeRepo(db),
    embeddings: new EmbeddingRepo(db),
    operationLog: new OperationLogRepo(db),
    memoryRetrieval: new MemoryRetrieval(db),
  };

  // Wire latency tracker repo accessor
  setLatencyRepoAccessor(() => repos.operationLog);

  // Provider registry
  const registry: ProviderRegistry = {
    llm: new Map(),
    stt: new Map(),
    tts: new Map(),
    research: new Map(),
    embedding: new Map(),
  };

  // Register xAI providers when configured
  if (config.secrets.xaiApiKey) {
    const xaiLlm = createXaiLlmProvider(config.secrets.xaiApiKey);
    registry.llm.set('xai', xaiLlm);

    const xaiEmbedding = createXaiEmbeddingProvider(config.secrets.xaiApiKey);
    registry.embedding.set('xai', xaiEmbedding);
  }

  // Register Voyage embedding provider when configured
  if (config.secrets.voyageApiKey) {
    const voyageEmbedding = createVoyageEmbeddingProvider(config.secrets.voyageApiKey);
    registry.embedding.set('voyage', voyageEmbedding);
  }

  // Validate provider configuration (secrets for routed providers)
  const validation = validateProviderConfig(config);
  if (!validation.valid) {
    throw new Error(
      `Provider validation failed:\n${validation.errors.map((e: string) => `  • ${e}`).join('\n')}`,
    );
  }

  // Provider router
  const providers = createProviderRouter(config, registry);

  // Queues
  const queues = createQueues(redis);

  // Workers
  let embeddingWorker: Awaited<ReturnType<typeof startEmbeddingWorker>> | undefined;
  try {
    const { provider: embeddingProvider, model: embeddingModel } = providers.getEmbedding();
    embeddingWorker = startEmbeddingWorker({ redis, db, embeddingProvider, embeddingModel });
  } catch {
    logger.warn('Embedding provider not registered — embedding worker disabled');
  }
  const consolidationWorker = startMemoryConsolidationWorker({ redis, db });

  // Wire container (discord left undefined — caller adds it when needed)
  const container: Container = { config, db, redis, repos, queues, providers };
  setContainer(container);

  // Graceful shutdown helper
  const shutdown = async () => {
    logger.info('Shutting down…');
    await embeddingWorker?.close();
    await consolidationWorker.close();
    await queues.embeddingGeneration.close();
    await queues.memoryConsolidation.close();
    await redis.quit();
    await pool.end();
    await db.destroy();
    await shutdownTracer();
  };

  return { config, container, db, redis, shutdown };
}
