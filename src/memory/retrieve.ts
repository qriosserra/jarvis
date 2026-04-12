import type { InteractionContext } from '../interaction/types.js';
import type { ScoredMemory } from '../db/repos.js';
import { getContainer } from '../container.js';
import { selectBestName } from './identity.js';
import { createLogger } from '../lib/logger.js';
import { trackOperation } from '../lib/latency-tracker.js';

const logger = createLogger('memory-retrieve');

// ── Retrieved context ───────────────────────────────────────────────

export interface RetrievedContext {
  /** Relevant memories for this interaction, ranked by score. */
  memories: ScoredMemory[];
  /** Best known name for the requester (or null). */
  requesterName: string | null;
  /** Formatted context string for injection into the LLM prompt. */
  formattedContext: string;
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Retrieve relevant memory context for an interaction.
 *
 * Combines:
 * - Vector similarity search (if embedding provider available)
 * - Recency-based fallback
 * - Requester name resolution
 *
 * Returns a formatted string suitable for injection into the
 * response generation system prompt.
 */
export async function retrieveContext(
  ctx: InteractionContext,
  parentOperationId?: string,
): Promise<RetrievedContext> {
  const container = getContainer();

  // Resolve requester name
  let requesterName: string | null = null;
  try {
    const bestName = await selectBestName(ctx.requester.id, ctx.guildId);
    requesterName = bestName?.name ?? null;
  } catch {
    // Non-critical
  }

  // Retrieve memories
  let memories: ScoredMemory[] = [];
  try {
    memories = await retrieveMemories(ctx, parentOperationId);
  } catch (err) {
    logger.warn(
      { correlationId: ctx.correlationId, err },
      'Memory retrieval failed',
    );
  }

  const formattedContext = formatContext(memories, requesterName, ctx);

  logger.debug(
    {
      correlationId: ctx.correlationId,
      memoryCount: memories.length,
      requesterName,
    },
    'Context retrieved for interaction',
  );

  return { memories, requesterName, formattedContext };
}

// ── Memory retrieval ────────────────────────────────────────────────

async function retrieveMemories(ctx: InteractionContext, parentOperationId?: string): Promise<ScoredMemory[]> {
  const container = getContainer();
  const retrieval = container.repos.memoryRetrieval;

  const filter = {
    guildId: ctx.guildId,
    memberId: ctx.requester.id,
    limit: 10,
  };

  // Try vector search first (requires embedding of the request)
  try {
    const { provider: embeddingProvider, model: embeddingModel } = container.providers.getEmbedding();
    const { result: embedResult } = await trackOperation(
      {
        operationName: 'embedding_query',
        operationType: 'embedding',
        providerName: embeddingProvider.name,
        model: embeddingModel,
        context: {
          correlationId: ctx.correlationId,
          guildId: ctx.guildId,
          memberId: ctx.requester.id,
          interactionId: ctx.interactionId,
          parentOperationId,
        },
        metadata: { inputType: 'query' },
      },
      () => embeddingProvider.embed(ctx.requestText, { model: embeddingModel, inputType: 'query' }),
    );

    const results = await retrieval.searchHybrid(
      embedResult.embedding,
      filter,
      { vectorWeight: 0.6, decayDays: 30 },
    );

    if (results.length > 0) return results;
  } catch {
    // Embedding not available — fall through to recency
  }

  // Fallback: recency-based retrieval
  return retrieval.searchByRecency(filter);
}

// ── Formatting ──────────────────────────────────────────────────────

function formatContext(
  memories: ScoredMemory[],
  requesterName: string | null,
  ctx: InteractionContext,
): string {
  const parts: string[] = [];

  if (requesterName) {
    parts.push(
      `The user's preferred name is "${requesterName}". ` +
      'Use this name when addressing them.',
    );
  }

  if (memories.length > 0) {
    const memoryLines = memories
      .filter((m) => m.confidence >= 0.5)
      .slice(0, 8)
      .map((m) => {
        const age = ageLabel(m.createdAt);
        return `- [${m.category}] ${m.content} (${age}, confidence: ${m.confidence.toFixed(1)})`;
      });

    if (memoryLines.length > 0) {
      parts.push(
        'Relevant memories from prior interactions:\n' +
        memoryLines.join('\n'),
      );
    }
  }

  return parts.join('\n\n');
}

function ageLabel(date: Date): string {
  const ms = Date.now() - new Date(date).getTime();
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}
