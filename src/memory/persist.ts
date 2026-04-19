import type { InteractionContext } from '../interaction/types.js';
import type { ExtractedMemory } from './extract.js';
import { extractMemories } from './extract.js';
import { getContainer } from '../container.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('memory-persist');

/**
 * Persist an interaction and its extracted memories.
 *
 * 1. Records the interaction in the database.
 * 2. Extracts structured memories via LLM.
 * 3. Stores each memory record and enqueues embedding generation.
 *
 * This runs after the response has been delivered — it is not
 * on the latency-critical path.
 */
export async function persistInteractionMemory(
  ctx: InteractionContext,
  responseText: string,
  intentKind: string,
): Promise<void> {
  const container = getContainer();

  // Reuse the early-created interaction row from the orchestrator
  const interactionId = ctx.interactionId;

  // Extract and store memories (best-effort, non-blocking)
  try {
    const memories = await extractMemories(ctx, responseText, intentKind);
    await storeMemories(ctx, memories, interactionId);
  } catch (err) {
    logger.warn(
      { correlationId: ctx.correlationId, err },
      'Memory extraction/storage failed',
    );
  }
}

/**
 * Persist an action outcome as a memory record directly,
 * without LLM extraction (deterministic actions already have
 * structured results).
 */
export async function persistActionOutcomeMemory(
  ctx: InteractionContext,
  actionType: string,
  success: boolean,
  message: string,
  sourceInteractionId?: string,
): Promise<void> {
  const container = getContainer();

  try {
    const content = `Action "${actionType}" ${success ? 'succeeded' : 'failed'}: ${message.slice(0, 200)}`;

    const record = await container.repos.memoryRecords.create({
      guildId: ctx.guildId,
      memberId: ctx.requester.id,
      membershipId: ctx.membershipId ?? null,
      category: 'action_outcome',
      content,
      capability: actionType,
      confidence: 1.0,
      sourceInteractionId: sourceInteractionId ?? null,
    });

    // Enqueue embedding generation
    await container.queues.embeddingGeneration.add('embed', {
      memoryRecordId: record.id,
      content: record.content,
      guildId: ctx.guildId,
    });

    logger.debug(
      { correlationId: ctx.correlationId, memoryId: record.id, actionType },
      'Action outcome memory persisted',
    );
  } catch (err) {
    logger.warn(
      { correlationId: ctx.correlationId, err },
      'Failed to persist action outcome memory',
    );
  }
}

// ── Internal helpers ────────────────────────────────────────────────

async function storeMemories(
  ctx: InteractionContext,
  memories: ExtractedMemory[],
  interactionId?: string,
): Promise<void> {
  if (memories.length === 0) return;

  const container = getContainer();

  for (const mem of memories) {
    try {
      const record = await container.repos.memoryRecords.create({
        guildId: ctx.guildId,
        memberId: ctx.requester.id,
        membershipId: ctx.membershipId ?? null,
        category: mem.category,
        content: mem.content,
        capability: mem.capability ?? null,
        confidence: mem.confidence,
        sourceInteractionId: interactionId ?? null,
      });

      // Enqueue embedding generation for vector retrieval
      await container.queues.embeddingGeneration.add('embed', {
        memoryRecordId: record.id,
        content: record.content,
        guildId: ctx.guildId,
      });
    } catch (err) {
      logger.warn(
        { correlationId: ctx.correlationId, category: mem.category, err },
        'Failed to persist memory record',
      );
    }
  }

  logger.debug(
    { correlationId: ctx.correlationId, count: memories.length },
    'Interaction memories stored',
  );
}
