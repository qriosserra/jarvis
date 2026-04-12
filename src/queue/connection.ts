import type { Redis } from 'ioredis';

/**
 * BullMQ uses ioredis under the hood. We expose the shared Redis instance
 * so queues and workers can reuse the same connection created in index.ts.
 *
 * BullMQ requires `maxRetriesPerRequest: null` on the connection, which is
 * already set during Redis construction in the application entrypoint.
 */
export interface QueueDeps {
  redis: Redis;
}
