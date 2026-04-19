import type { LlmMessage } from '../providers/types.js';
import type { InteractionContext } from '../interaction/types.js';
import type { MemoryCategory } from '../db/types.js';
import { getContainer } from '../container.js';
import { createLogger, captureCallSite } from '../lib/logger.js';
import { trackOperation, formatTokens, formatDuration, formatLength } from '../lib/latency-tracker.js';
import { OperationName, OperationType, OperationMetadata } from '../lib/operation-constants.js';

const logger = createLogger('memory-extract');

// ── Extraction types ────────────────────────────────────────────────

export interface ExtractedMemory {
  category: MemoryCategory;
  content: string;
  /** Optional capability tag for action-outcome memories. */
  capability?: string;
  confidence: number;
}

// ── Extraction prompt ───────────────────────────────────────────────

const EXTRACTION_SYSTEM_PROMPT = `You are a memory extraction system for a Discord assistant.
Given a completed interaction (user request + assistant response), extract useful memories to persist.

Return a JSON array of memory objects. Each object must have:
- "category": one of "summary", "fact", "preference", "action_outcome"
- "content": a concise description of what to remember (1-2 sentences max)
- "confidence": 0.0 to 1.0 how confident this memory is useful long-term

Categories:
- "summary": a compact summary of what happened in the interaction
- "fact": a factual statement about the user or topic that was discussed
- "preference": a user preference that was expressed or implied
- "action_outcome": an action that was taken and its result

Rules:
- Return ONLY the JSON array, no explanation.
- Return an empty array [] if nothing is worth remembering.
- Keep each memory concise (max 150 characters).
- Prefer structured facts over verbose summaries.
- Do NOT store sensitive information like passwords or tokens.
- Produce at most 3 memories per interaction.`;

// ── Public API ──────────────────────────────────────────────────────

/**
 * Extract structured memories from a completed interaction using
 * the response LLM. Returns an array of memory records to persist.
 *
 * Best-effort — returns empty array on failure.
 */
export async function extractMemories(
  ctx: InteractionContext,
  responseText: string,
  intentKind: string,
): Promise<ExtractedMemory[]> {
  const container = getContainer();

  try {
    const { provider, model } = container.providers.getLlm('response');

    const messages: LlmMessage[] = [
      { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
      {
        role: 'user',
        content:
          `User (${ctx.requester.displayName ?? ctx.requester.username}): ${ctx.requestText}\n` +
          `Assistant response: ${responseText.slice(0, 500)}\n` +
          `Intent: ${intentKind}`,
      },
    ];

    const { result, durationMs } = await trackOperation(
      {
        operationName: OperationName.LLM_MEMORY_EXTRACTION,
        operationType: OperationType.LLM,
        providerName: provider.name,
        model,
        context: {
          correlationId: ctx.correlationId,
          guildId: ctx.guildId,
          memberId: ctx.requester.id,
          interactionId: ctx.interactionId,
        },
        metadata: { task: OperationMetadata.Task.MEMORY_EXTRACTION, intentKind },
      },
      () => provider.complete(messages, { model, temperature: 0.2, maxTokens: 512 }),
      (resp) => ({
        providerDurationMs: resp.providerDurationMs ?? null,
        inputTokens: resp.usage?.promptTokens ?? null,
        outputTokens: resp.usage?.completionTokens ?? null,
      }),
    );

    const memories = parseExtractedMemories(result.content);

    const promptChars = messages.reduce((sum, m) => sum + m.content.length, 0);

    // Consolidated LLM log — replaces per-step info/debug lines.
    logger.debug(
      {
        source: captureCallSite('extractMemories'),
        model: `${provider.name} | ${result.model}`,
        duration: formatDuration(durationMs, result.providerDurationMs),
        chars: formatLength(promptChars, result.content.length),
        tokens: formatTokens(
          result.usage?.promptTokens,
          result.usage?.completionTokens,
        ),
        extractedCount: memories.length,
        prompt: messages,
        response: result.content,
        correlationId: ctx.correlationId,
      },
      'LLM memory extraction',
    );

    return memories;
  } catch (err) {
    logger.warn(
      { correlationId: ctx.correlationId, err },
      'Memory extraction failed',
    );
    return [];
  }
}

// ── Parsing ─────────────────────────────────────────────────────────

const VALID_CATEGORIES = new Set<string>(['summary', 'fact', 'preference', 'action_outcome']);

function parseExtractedMemories(raw: string): ExtractedMemory[] {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }

  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (m: unknown): m is { category: string; content: string; confidence?: number } =>
          typeof m === 'object' &&
          m !== null &&
          'category' in m &&
          'content' in m &&
          typeof (m as Record<string, unknown>).category === 'string' &&
          typeof (m as Record<string, unknown>).content === 'string' &&
          VALID_CATEGORIES.has((m as Record<string, unknown>).category as string),
      )
      .slice(0, 3)
      .map((m) => ({
        category: m.category as MemoryCategory,
        content: m.content.slice(0, 300),
        confidence: typeof m.confidence === 'number' ? Math.min(1, Math.max(0, m.confidence)) : 0.8,
      }));
  } catch {
    logger.debug({ raw: cleaned.slice(0, 200) }, 'Failed to parse memory extraction JSON');
    return [];
  }
}
