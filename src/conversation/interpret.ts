import { trace } from '@opentelemetry/api';
import type { InteractionContext } from '../interaction/types.js';
import { IntentKind, type IntentOutcome } from '../interaction/intent.js';
import type { LlmMessage } from '../providers/types.js';
import type { Persona } from '../db/types.js';
import { getContainer } from '../container.js';
import { INTERPRETATION_SYSTEM_PROMPT, buildInterpretationContext } from './prompts.js';
import { createLogger, captureCallSite } from '../lib/logger.js';
import { trackOperation, formatTokens, formatDuration, formatLength } from '../lib/latency-tracker.js';
import { OperationName, OperationType, OperationMetadata } from '../lib/operation-constants.js';
import { llmLatency, providerErrorCounter } from '../lib/metrics.js';

const logger = createLogger('interpret');

/**
 * Interpret user intent via the configured interpretation LLM.
 *
 * Sends the request text to the LLM with a structured classification
 * prompt and parses the JSON response into a typed `IntentOutcome`.
 * Falls back to a generic `respond` intent on parse failure.
 */
export async function interpretIntent(ctx: InteractionContext): Promise<IntentOutcome> {
  const container = getContainer();
  const { provider, model } = container.providers.getLlm('interpretation');

  // Load persona for name-aware classification
  const persona = await loadPersona(ctx.personaId);
  const extraContext = buildInterpretationContext(persona, ctx.language);

  const messages: LlmMessage[] = [
    { role: 'system', content: INTERPRETATION_SYSTEM_PROMPT + (extraContext ? '\n\n' + extraContext : '') },
    { role: 'user', content: ctx.requestText },
  ];

  const tracer = trace.getTracer('jarvis');
  return tracer.startActiveSpan('interpretIntent', async (span): Promise<IntentOutcome> => {
    try {
      const { result: response, durationMs } = await trackOperation(
        {
          operationName: OperationName.LLM_INTERPRETATION,
          operationType: OperationType.LLM,
          providerName: provider.name,
          model,
          context: {
            correlationId: ctx.correlationId,
            guildId: ctx.guildId,
            memberId: ctx.requester.id,
            interactionId: ctx.interactionId,
          },
          metadata: { task: OperationMetadata.Task.INTERPRETATION },
        },
        () => provider.complete(messages, { model, temperature: 0.1, maxTokens: 256 }),
        (resp) => ({
          providerDurationMs: resp.providerDurationMs ?? null,
          inputTokens: resp.usage?.promptTokens ?? null,
          outputTokens: resp.usage?.completionTokens ?? null,
        }),
      );

      llmLatency.record(durationMs, { task: 'interpretation', provider: provider.name });

      const intent = parseIntentJson(response.content);

      span.setAttributes({
        'jarvis.intent_kind': intent.kind,
        'jarvis.llm_model': response.model,
      });

      const promptChars = messages.reduce((sum, m) => sum + m.content.length, 0);

      // Consolidated LLM log — replaces the removed per-step info/debug lines.
      logger.debug(
        {
          source: captureCallSite('interpretIntent'),
          model: `${provider.name} | ${response.model}`,
          duration: formatDuration(durationMs, response.providerDurationMs),
          chars: formatLength(promptChars, response.content.length),
          tokens: formatTokens(
            response.usage?.promptTokens,
            response.usage?.completionTokens,
          ),
          intent: intent.kind,
          prompt: messages,
          response: response.content,
          correlationId: ctx.correlationId,
        },
        'LLM interpretation',
      );

      return intent;
    } catch (err) {
      providerErrorCounter.add(1, { type: 'llm', provider: provider.name, task: 'interpretation' });
      logger.error(
        { correlationId: ctx.correlationId, err },
        'Intent interpretation failed, falling back to respond',
      );
      return { kind: IntentKind.Respond };
    } finally {
      span.end();
    }
  });
}

// ── JSON parsing ────────────────────────────────────────────────────

const VALID_KINDS: ReadonlySet<string> = new Set<string>(Object.values(IntentKind));

function parseIntentJson(raw: string): IntentOutcome {
  // Strip markdown code fences if present
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }

  const parsed = JSON.parse(cleaned);

  if (!parsed || typeof parsed !== 'object' || !VALID_KINDS.has(parsed.kind)) {
    logger.warn({ raw: cleaned }, 'Invalid intent JSON, falling back to respond');
    return { kind: IntentKind.Respond };
  }

  // Validate required fields per intent kind
  switch (parsed.kind) {
    case IntentKind.Respond:
      return { kind: IntentKind.Respond, responseHint: parsed.responseHint };

    case IntentKind.AskClarification:
      if (typeof parsed.question !== 'string') return { kind: IntentKind.Respond };
      return { kind: IntentKind.AskClarification, question: parsed.question };

    case IntentKind.ResearchAndRespond:
      if (typeof parsed.query !== 'string') return { kind: IntentKind.Respond };
      return { kind: IntentKind.ResearchAndRespond, query: parsed.query };

    case IntentKind.JoinVoice:
      if (typeof parsed.channelRef !== 'string') return { kind: IntentKind.Respond };
      return { kind: IntentKind.JoinVoice, channelRef: parsed.channelRef };

    case IntentKind.MoveMember:
      if (typeof parsed.targetRef !== 'string' || typeof parsed.destinationRef !== 'string')
        return { kind: IntentKind.Respond };
      return { kind: IntentKind.MoveMember, targetRef: parsed.targetRef, destinationRef: parsed.destinationRef };

    case IntentKind.MuteMember:
      if (typeof parsed.targetRef !== 'string' || typeof parsed.mute !== 'boolean')
        return { kind: IntentKind.Respond };
      return { kind: IntentKind.MuteMember, targetRef: parsed.targetRef, mute: parsed.mute };

    case IntentKind.DeafenMember:
      if (typeof parsed.targetRef !== 'string' || typeof parsed.deafen !== 'boolean')
        return { kind: IntentKind.Respond };
      return { kind: IntentKind.DeafenMember, targetRef: parsed.targetRef, deafen: parsed.deafen };

    case IntentKind.RenameMember:
      if (typeof parsed.targetRef !== 'string' || typeof parsed.newName !== 'string')
        return { kind: IntentKind.Respond };
      return { kind: IntentKind.RenameMember, targetRef: parsed.targetRef, newName: parsed.newName };

    case IntentKind.SendTextMessage:
      if (typeof parsed.message !== 'string') return { kind: IntentKind.Respond };
      return {
        kind: IntentKind.SendTextMessage,
        message: parsed.message,
        channelRef: typeof parsed.channelRef === 'string' ? parsed.channelRef : undefined,
      };

    default:
      return { kind: IntentKind.Respond };
  }
}

// ── Persona loading ─────────────────────────────────────────────────

async function loadPersona(personaId?: string): Promise<Persona | null> {
  if (!personaId) return null;

  try {
    const container = getContainer();
    return await container.repos.personas.findByName(personaId);
  } catch (err) {
    logger.warn({ personaId, err }, 'Failed to load persona for interpretation');
    return null;
  }
}
