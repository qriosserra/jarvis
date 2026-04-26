import type { TextChannel } from 'discord.js';
import type { InteractionContext } from '../interaction/types.js';
import { IntentKind, type IntentOutcome } from '../interaction/intent.js';
import type { LlmMessage } from '../providers/types.js';
import type { Persona } from '../db/types.js';
import { getContainer, getDiscordClient } from '../container.js';
import { buildResponseSystemPrompt, buildResearchContext } from './prompts.js';
import { retrieveContext } from '../memory/retrieve.js';
import { getActiveConnection } from '../voice/connection.js';
import { speakWithAcknowledgement } from '../voice/playback.js';
import { DEFAULT_VOICE_CONFIG } from '../voice/types.js';
import { createLogger, captureCallSite } from '../lib/logger.js';
import { trackOperation, formatTokens, formatDuration, formatLength, type OperationContext } from '../lib/latency-tracker.js';
import { OperationName, OperationType, OperationMetadata } from '../lib/operation-constants.js';
import { llmLatency, researchLatency, providerErrorCounter } from '../lib/metrics.js';

const logger = createLogger('respond');

function respondCtx(ctx: InteractionContext): OperationContext {
  return {
    correlationId: ctx.correlationId,
    guildId: ctx.guildId,
    memberId: ctx.requester.id,
    interactionId: ctx.interactionId,
  };
}

/**
 * Generate and deliver a conversational response for the given intent.
 *
 * Handles:
 * - `respond` — direct LLM answer
 * - `ask-clarification` — forward the question
 * - `research-and-respond` — search + synthesise
 *
 * Delivery is surface-aware: text reply for text, TTS for voice.
 */
export async function generateAndDeliver(
  ctx: InteractionContext,
  intent: IntentOutcome,
): Promise<string> {
  // Load persona
  const persona = await loadPersona(ctx.personaId);

  // Retrieve memory context (best-effort)
  let memoryContext = '';
  try {
    const retrieved = await retrieveContext(ctx);
    memoryContext = retrieved.formattedContext;
  } catch {
    // Non-critical — proceed without memory context
  }

  // For voice surface, wrap response generation inside the ack flow
  // so the acknowledgement can fire during slow generation (e.g. research).
  if (ctx.surface === 'voice') {
    return generateAndDeliverVoice(ctx, intent, persona, memoryContext);
  }

  // Text surface — generate, then deliver
  const responseText = await generateResponseForIntent(ctx, intent, persona, memoryContext);

  await deliverTextReply(ctx, responseText);
  return responseText;
}

// ── Response generation ─────────────────────────────────────────────

async function generateResponse(
  ctx: InteractionContext,
  persona: Persona | null,
  memoryContext: string = '',
): Promise<string> {
  const container = getContainer();
  const { provider, model } = container.providers.getLlm('response');

  const systemPrompt = buildResponseSystemPrompt(persona, ctx.language);

  const messages: LlmMessage[] = [
    { role: 'system', content: systemPrompt },
  ];

  if (memoryContext) {
    messages.push({ role: 'system', content: memoryContext });
  }

  messages.push({ role: 'user', content: ctx.requestText });

  const { result: response, durationMs } = await trackOperation(
    {
      operationName: OperationName.LLM_RESPONSE,
      operationType: OperationType.LLM,
      providerName: provider.name,
      model,
      context: respondCtx(ctx),
      metadata: { task: OperationMetadata.Task.RESPONSE },
    },
    () => provider.complete(messages, { model, temperature: 0.7, maxTokens: 1024 }),
    (resp) => ({
      providerDurationMs: resp.providerDurationMs ?? null,
      inputTokens: resp.usage?.promptTokens ?? null,
      outputTokens: resp.usage?.completionTokens ?? null,
    }),
  );
  llmLatency.record(durationMs, { task: 'response', provider: provider.name });

  const promptChars = messages.reduce((sum, m) => sum + m.content.length, 0);

  // Consolidated LLM log — replaces per-step info/debug lines.
  logger.debug(
    {
      source: captureCallSite('generateResponse'),
      model: `${provider.name} | ${response.model}`,
      duration: formatDuration(durationMs, response.providerDurationMs),
      chars: formatLength(promptChars, response.content.length),
      tokens: formatTokens(
        response.usage?.promptTokens,
        response.usage?.completionTokens,
      ),
      prompt: messages,
      response: response.content,
      correlationId: ctx.correlationId,
    },
    'LLM response',
  );

  return response.content;
}

// ── Research-augmented response ─────────────────────────────────────

async function generateResearchResponse(
  ctx: InteractionContext,
  query: string,
  persona: Persona | null,
  memoryContext: string = '',
): Promise<string> {
  const container = getContainer();

  // Step 1 — search
  let researchContext = '';
  try {
    const researchProvider = container.providers.getResearch();
    const { result: results, durationMs: searchDurationMs } = await trackOperation(
      {
        operationName: OperationName.RESEARCH_SEARCH,
        operationType: OperationType.RESEARCH,
        providerName: researchProvider.name,
        context: respondCtx(ctx),
        metadata: { query },
      },
      () => researchProvider.search(query, { maxResults: 5 }),
    );
    researchLatency.record(searchDurationMs, { provider: researchProvider.name });

    logger.info(
      { correlationId: ctx.correlationId, query, resultCount: results.length },
      'Research results retrieved',
    );

    researchContext = buildResearchContext(results);
  } catch (err) {
    providerErrorCounter.add(1, { type: 'research', task: 'search' });
    logger.warn(
      { correlationId: ctx.correlationId, query, err },
      'Research failed, generating response without results',
    );
  }

  // Step 2 — synthesise
  const { provider, model } = container.providers.getLlm('response');
  const systemPrompt = buildResponseSystemPrompt(persona, ctx.language);

  const messages: LlmMessage[] = [
    { role: 'system', content: systemPrompt },
  ];

  if (memoryContext) {
    messages.push({ role: 'system', content: memoryContext });
  }

  if (researchContext) {
    messages.push({ role: 'system', content: researchContext });
  }

  messages.push({ role: 'user', content: ctx.requestText });

  const { result: response, durationMs: llmDurationMs } = await trackOperation(
    {
      operationName: OperationName.LLM_RESEARCH_RESPONSE,
      operationType: OperationType.LLM,
      providerName: provider.name,
      model,
      context: respondCtx(ctx),
      metadata: { task: OperationMetadata.Task.RESPONSE, researchAugmented: true },
    },
    () => provider.complete(messages, { model, temperature: 0.5, maxTokens: 1536 }),
    (resp) => ({
      providerDurationMs: resp.providerDurationMs ?? null,
      inputTokens: resp.usage?.promptTokens ?? null,
      outputTokens: resp.usage?.completionTokens ?? null,
    }),
  );
  llmLatency.record(llmDurationMs, { task: 'response', provider: provider.name });

  const researchPromptChars = messages.reduce((sum, m) => sum + m.content.length, 0);

  // Consolidated LLM log — replaces per-step info/debug lines.
  logger.debug(
    {
      source: captureCallSite('generateResearchResponse'),
      model: `${provider.name} | ${response.model}`,
      duration: formatDuration(llmDurationMs, response.providerDurationMs),
      chars: formatLength(researchPromptChars, response.content.length),
      tokens: formatTokens(
        response.usage?.promptTokens,
        response.usage?.completionTokens,
      ),
      prompt: messages,
      response: response.content,
      correlationId: ctx.correlationId,
    },
    'LLM research response',
  );

  return response.content;
}

// ── Intent → text dispatcher ────────────────────────────────────────

async function generateResponseForIntent(
  ctx: InteractionContext,
  intent: IntentOutcome,
  persona: Persona | null,
  memoryContext: string = '',
): Promise<string> {
  switch (intent.kind) {
    case IntentKind.AskClarification:
      return intent.question;
    case IntentKind.ResearchAndRespond:
      return generateResearchResponse(ctx, intent.query, persona, memoryContext);
    case IntentKind.Respond:
    default:
      return generateResponse(ctx, persona, memoryContext);
  }
}

// ── Voice delivery (ack-aware) ──────────────────────────────────────

/**
 * For voice surface, the response generation runs *inside* the
 * `speakWithAcknowledgement` callback so the ack timeout can fire
 * during slow generation (research, long LLM calls).
 */
async function generateAndDeliverVoice(
  ctx: InteractionContext,
  intent: IntentOutcome,
  persona: Persona | null,
  memoryContext: string = '',
): Promise<string> {
  const managed = getActiveConnection(ctx.guildId);

  if (!managed) {
    logger.warn(
      { correlationId: ctx.correlationId, guildId: ctx.guildId },
      'No active voice connection for guild, falling back to text reply',
    );
    const text = await generateResponseForIntent(ctx, intent, persona, memoryContext);
    await deliverTextReply(ctx, text);
    return text;
  }

  try {
    const container = getContainer();
    const ttsProvider = container.providers.getTts();

    const result = await speakWithAcknowledgement(
      managed.connection,
      ctx.guildId,
      ttsProvider,
      () => generateResponseForIntent(ctx, intent, persona, memoryContext),
      Date.now(),
      {
        timeoutMs: DEFAULT_VOICE_CONFIG.ackTimeoutMs,
        language: ctx.language,
      },
    );

    logger.info(
      {
        correlationId: ctx.correlationId,
        intentKind: intent.kind,
        usedAck: result.usedAcknowledgement,
        endToEndMs: result.endToEndMs,
        synthesisMs: result.latency.synthesisMs,
      },
      'Voice reply delivered',
    );

    return result.responseText;
  } catch (err) {
    logger.error(
      { correlationId: ctx.correlationId, err },
      'Voice reply failed, falling back to text',
    );
    const text = await generateResponseForIntent(ctx, intent, persona, memoryContext);
    await deliverTextReply(ctx, text);
    return text;
  }
}

// ── Text delivery ───────────────────────────────────────────────────

async function deliverTextReply(ctx: InteractionContext, text: string): Promise<void> {
  // CLI / headless — deliver via the injected reply handler
  if (ctx.replyHandler) {
    await ctx.replyHandler(text);
    return;
  }

  // Prefer replying to the source message
  if (ctx.sourceMessage) {
    try {
      await ctx.sourceMessage.reply(text);
      return;
    } catch (err) {
      logger.warn(
        { correlationId: ctx.correlationId, err },
        'Failed to reply to source message, falling back to channel send',
      );
    }
  }

  // Fallback — send directly in the channel
  try {
    const discord = getDiscordClient();
    const channel = await discord.channels.fetch(ctx.channelId);
    if (channel && 'send' in channel) {
      await (channel as TextChannel).send(text);
    }
  } catch (err) {
    logger.error(
      { correlationId: ctx.correlationId, err },
      'Failed to send response to channel',
    );
  }
}

// ── Persona loading ─────────────────────────────────────────────────

async function loadPersona(personaId?: string): Promise<Persona | null> {
  if (!personaId) return null;

  try {
    const container = getContainer();
    return await container.repos.personas.findByName(personaId);
  } catch (err) {
    logger.warn({ personaId, err }, 'Failed to load persona');
    return null;
  }
}
