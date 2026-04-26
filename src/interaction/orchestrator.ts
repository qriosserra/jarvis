import { trace } from '@opentelemetry/api';
import type { InteractionContext } from './types.js';
import type { IntentOutcome } from './intent.js';
import { isDeterministicIntent } from './intent.js';
import { executeAction } from '../actions/executor.js';
import { interpretIntent as llmInterpretIntent } from '../conversation/interpret.js';
import { generateAndDeliver } from '../conversation/respond.js';
import { persistInteractionMemory, persistActionOutcomeMemory } from '../memory/persist.js';
import { ingestRequesterNames } from '../memory/identity.js';
import { getContainer } from '../container.js';
import { createLogger } from '../lib/logger.js';
import { trackOperation, runTrackedPipeline, type OperationContext } from '../lib/latency-tracker.js';
import { OperationName, OperationType } from '../lib/operation-constants.js';
import {
  interactionCounter,
  interactionDuration,
  intentClassificationCounter,
} from '../lib/metrics.js';

const logger = createLogger('orchestrator');

function opCtx(ctx: InteractionContext): OperationContext {
  return {
    correlationId: ctx.correlationId,
    guildId: ctx.guildId,
    memberId: ctx.requester.id,
    interactionId: ctx.interactionId,
  };
}

// ── Public entry point ─────────────────────────────────────────────────

/**
 * Process a normalised interaction through the full Jarvis pipeline:
 *
 * 1. Interpret intent via the configured interpretation LLM.
 * 2. Route to the deterministic-action executor **or** the
 *    conversational-response path based on intent kind.
 */
export async function handleInteraction(ctx: InteractionContext): Promise<void> {
  const tracer = trace.getTracer('jarvis');
  const startMs = Date.now();

  return tracer.startActiveSpan('handleInteraction', async (span) => {
    span.setAttributes({
      'jarvis.guild_id': ctx.guildId,
      'jarvis.surface': ctx.surface,
      'jarvis.trigger': ctx.trigger,
      'jarvis.requester_id': ctx.requester.id,
      'jarvis.correlation_id': ctx.correlationId,
    });

    logger.info(
      {
        correlationId: ctx.correlationId,
        guildId: ctx.guildId,
        surface: ctx.surface,
        trigger: ctx.trigger,
        requester: ctx.requester.id,
      },
      'Orchestrating interaction',
    );

    await trackOperation(
      {
        operationName: OperationName.INTERACTION,
        operationType: OperationType.PIPELINE,
        context: opCtx(ctx),
        metadata: { surface: ctx.surface, trigger: ctx.trigger },
      },
      async () => {
        try {
          await runTrackedPipeline({ operationType: OperationType.PIPELINE, context: opCtx(ctx) }, [
            // Step 0a — ensure the guild row exists before any guild-scoped writes
            [OperationName.GUILD_BOOTSTRAP,      () => bootstrapGuild(ctx)],
            // Step 0a-2 — bootstrap user + guild membership so all downstream
          // writes have a valid membership FK.
            [OperationName.MEMBERSHIP_BOOTSTRAP, () => bootstrapMembership(ctx)],
            // Step 0b — resolve persona name → DB UUID for persistence
            [OperationName.PERSONA_RESOLUTION,   () => resolvePersona(ctx)],
          ]);

          // Step 0c — create the interaction row early so all downstream
          // latency records and action outcomes can reference its UUID.
          await createEarlyInteraction(ctx);

          // Step 0d — refresh identity records (non-blocking)
          ingestRequesterNames(ctx).catch(() => {});

          // Step 1 — intent interpretation
          const { result: intent } = await trackOperation(
            { operationName: OperationName.INTENT_INTERPRETATION, operationType: OperationType.PIPELINE, context: opCtx(ctx) },
            () => interpretIntent(ctx),
          );

          span.setAttribute('jarvis.intent_kind', intent.kind);

          // Record classification metrics
          interactionCounter.add(1, {
            surface: ctx.surface,
            trigger: ctx.trigger,
            intent_kind: intent.kind,
          });
          intentClassificationCounter.add(1, { kind: intent.kind });

          // Step 2 — route by intent category
          if (isDeterministicIntent(intent)) {
            await trackOperation(
              { operationName: OperationName.DETERMINISTIC_ACTION, operationType: OperationType.PIPELINE, context: opCtx(ctx), metadata: { intentKind: intent.kind } },
              () => executeDeterministicAction(ctx, intent),
            );
          } else {
            await trackOperation(
              { operationName: OperationName.CONVERSATIONAL_RESPONSE, operationType: OperationType.PIPELINE, context: opCtx(ctx), metadata: { intentKind: intent.kind } },
              () => executeConversationalResponse(ctx, intent),
            );
          }

          // Step 3 — enqueue memory consolidation (best-effort, non-blocking)
          try {
            await getContainer().queues.memoryConsolidation.add('consolidate', {
              guildId: ctx.guildId,
              memberId: ctx.requester.id,
            });
          } catch {
            // Memory consolidation is non-critical
          }
        } finally {
          interactionDuration.record(Date.now() - startMs, {
            surface: ctx.surface,
            trigger: ctx.trigger,
          });
          span.end();
        }
      },
    );
  });
}

// ── Guild bootstrap ─────────────────────────────────────────────────

/**
 * Upsert the guild row so that downstream writes (interactions,
 * memory records, identity aliases) never hit a missing FK.
 */
async function bootstrapGuild(ctx: InteractionContext): Promise<void> {
  const container = getContainer();
  try {
    await container.repos.guilds.upsert({ id: ctx.guildId, name: ctx.guildName });
  } catch (err) {
    logger.error(
      { guildId: ctx.guildId, err },
      'Failed to bootstrap guild row — downstream writes may fail',
    );
    throw err;
  }
}

// ── Membership bootstrap ─────────────────────────────────────────────

/**
 * Upsert the global user row and the guild_membership row so that
 * downstream writes (interactions, memory records, identity aliases)
 * can reference a stable membership UUID via foreign key.
 */
async function bootstrapMembership(ctx: InteractionContext): Promise<void> {
  const container = getContainer();
  try {
    // Ensure the global user row exists
    await container.repos.users.upsert({
      id: ctx.requester.id,
      username: ctx.requester.username,
    });

    // Upsert the guild membership and capture its UUID
    const membership = await container.repos.guildMemberships.upsert({
      guildId: ctx.guildId,
      userId: ctx.requester.id,
      displayName: ctx.requester.displayName,
    });
    ctx.membershipId = membership.id;

    // Also keep the legacy members table in sync during the transition
    await container.repos.members.upsert({
      id: ctx.requester.id,
      guildId: ctx.guildId,
      username: ctx.requester.username,
      displayName: ctx.requester.displayName,
    });
  } catch (err) {
    logger.warn(
      { requesterId: ctx.requester.id, guildId: ctx.guildId, err },
      'Failed to bootstrap membership — downstream writes will lack membership FK',
    );
  }
}

// ── Persona resolution ──────────────────────────────────────────────

/**
 * Resolve the configured persona name (e.g. "jarvis") into the actual
 * database UUID so downstream persistence writes the correct FK value.
 *
 * Non-fatal: if the persona cannot be resolved, we log a warning and
 * leave `resolvedPersonaDbId` unset so the interaction still proceeds
 * (persistence will write NULL for persona_id).
 */
async function resolvePersona(ctx: InteractionContext): Promise<void> {
  if (!ctx.personaId) return;

  try {
    const container = getContainer();
    const persona = await container.repos.personas.findByName(ctx.personaId);
    if (persona) {
      ctx.resolvedPersonaDbId = persona.id;
    } else {
      logger.warn(
        { personaName: ctx.personaId },
        'Configured persona not found in database — interaction will persist without persona FK',
      );
    }
  } catch (err) {
    logger.warn(
      { personaName: ctx.personaId, err },
      'Failed to resolve persona — interaction will persist without persona FK',
    );
  }
}

// ── Early interaction creation ────────────────────────────────────────

/**
 * Create the interaction row as early as possible so that all downstream
 * latency records and action outcomes can reference its UUID.
 *
 * The row is created with request metadata and the resolved persona
 * (if available).  `response_text` will be backfilled later via
 * `interactions.update()` once the final response is known.
 *
 * Best-effort: if creation fails, we log and continue — the interaction
 * will proceed but latency records won't have an interaction FK.
 */
async function createEarlyInteraction(ctx: InteractionContext): Promise<void> {
  try {
    const container = getContainer();
    const interaction = await container.repos.interactions.create({
      guildId: ctx.guildId,
      memberId: ctx.requester.id,
      membershipId: ctx.membershipId ?? null,
      channelId: ctx.channelId,
      surface: ctx.surface,
      requestText: ctx.requestText,
      personaId: ctx.resolvedPersonaDbId ?? null,
      language: ctx.language ?? null,
      correlationId: ctx.correlationId,
    });
    ctx.interactionId = interaction.id;
    logger.debug(
      { correlationId: ctx.correlationId, interactionId: interaction.id },
      'Early interaction row created',
    );
  } catch (err) {
    logger.warn(
      { correlationId: ctx.correlationId, err },
      'Failed to create early interaction row — downstream latency linkage will be unavailable',
    );
  }
}

// ── Intent interpretation ────────────────────────────────────────────

/**
 * Resolve what the user is asking for via the configured
 * interpretation LLM provider.
 */
async function interpretIntent(ctx: InteractionContext): Promise<IntentOutcome> {
  return llmInterpretIntent(ctx);
}

// ── Deterministic action executor ───────────────────────────────────

/**
 * Execute a guild-mutating or channel-targeting action through
 * deterministic Discord handlers.
 */
async function executeDeterministicAction(
  ctx: InteractionContext,
  intent: IntentOutcome,
): Promise<void> {
  logger.info(
    { correlationId: ctx.correlationId, intentKind: intent.kind },
    'Routing to deterministic action handler',
  );

  await executeAction(ctx, intent);
}

// ── Conversational response path ────────────────────────────────────────

/**
 * Generate a natural-language response (text reply or spoken output)
 * for conversational, clarification, or research-backed intents.
 */
async function executeConversationalResponse(
  ctx: InteractionContext,
  intent: IntentOutcome,
): Promise<void> {
  logger.info(
    { correlationId: ctx.correlationId, intentKind: intent.kind },
    'Routing to conversational response path',
  );

  const responseText = await generateAndDeliver(ctx, intent);

  // Backfill response text on the early-created interaction row
  if (ctx.interactionId) {
    getContainer().repos.interactions.update(ctx.interactionId, { responseText }).catch((err) => {
      logger.warn({ correlationId: ctx.correlationId, err }, 'Failed to backfill interaction response');
    });
  }

  // Persist memories (best-effort, non-blocking)
  if (!ctx.skipMemoryPersistence) {
    const memoryTask = persistInteractionMemory(ctx, responseText, intent.kind).catch((err) => {
      logger.warn({ correlationId: ctx.correlationId, err }, 'Memory persistence failed');
    });
    if (ctx.backgroundTasks) {
      ctx.backgroundTasks.push(memoryTask);
    }
  }
}
