import type { Message } from 'discord.js';
import { createLogger } from '../lib/logger.js';
import type { LlmProvider } from '../providers/types.js';

const logger = createLogger('detection');

// ── Indirect classifier constants ──────────────────────────────────────

const INDIRECT_CLASSIFIER_SYSTEM_PROMPT =
  'You are a classifier. Reply with exactly YES or NO.';

const INDIRECT_CLASSIFIER_TEMPERATURE = 0;
const INDIRECT_CLASSIFIER_MAX_TOKENS = 5;
const INDIRECT_CLASSIFIER_POSITIVE_TOKEN = 'YES';

function buildIndirectClassifierUserPrompt(content: string): string {
  return (
    'Is this Discord message directed at an AI assistant (asking a question, ' +
    'requesting help, or expecting a bot reply)?\n' +
    `Message: "${content}"`
  );
}

// ── Detection result ───────────────────────────────────────────────────

export type TextDetectionResult =
  | { isForJarvis: false }
  | { isForJarvis: true; trigger: 'mention' | 'reply' | 'indirect' | 'dev-all' };

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Determine whether a guild text message is intended for Jarvis.
 *
 * Detection precedence:
 * 1. Direct @mention of the bot user
 * 2. Reply to a message authored by the bot user
 * 3. Conservative indirect-request classification (placeholder — always
 *    returns false until LLM-based classification is wired in)
 */
export function detectTextRequest(
  message: Message,
  botUserId: string,
): TextDetectionResult {
  if (isDirectMention(message, botUserId)) {
    return { isForJarvis: true, trigger: 'mention' };
  }

  if (isReplyToBot(message, botUserId)) {
    return { isForJarvis: true, trigger: 'reply' };
  }

  if (isIndirectRequest(message)) {
    return { isForJarvis: true, trigger: 'indirect' };
  }

  return { isForJarvis: false };
}

/**
 * LLM-based classifier for indirect requests — messages that do not
 * @mention the bot nor reply to it but are nonetheless addressed to an
 * AI assistant.
 *
 * Uses a tiny deterministic prompt (temperature 0, maxTokens 5) and
 * parses the single-token response: "YES" → indirect request, anything
 * else → not a request. Any provider error is treated as a negative
 * classification (fail-safe — never trigger Jarvis on a failed call).
 *
 * Callers are expected to invoke this only when
 * `config.interaction.indirectDetectionEnabled` is `true` and after the
 * cheap synchronous triggers in `detectTextRequest` have already
 * returned `{ isForJarvis: false }`.
 */
export async function detectIndirectRequest(
  message: Message,
  provider: LlmProvider,
  model: string,
): Promise<TextDetectionResult> {
  const content = message.content?.trim() ?? '';
  if (!content) {
    return { isForJarvis: false };
  }

  try {
    const response = await provider.complete(
      [
        { role: 'system', content: INDIRECT_CLASSIFIER_SYSTEM_PROMPT },
        { role: 'user', content: buildIndirectClassifierUserPrompt(content) },
      ],
      {
        model,
        temperature: INDIRECT_CLASSIFIER_TEMPERATURE,
        maxTokens: INDIRECT_CLASSIFIER_MAX_TOKENS,
      },
    );

    const verdict = response.content.trim().toUpperCase();
    const isForJarvis = verdict.startsWith(INDIRECT_CLASSIFIER_POSITIVE_TOKEN);

    logger.debug(
      {
        messageId: message.id,
        verdict,
        isForJarvis,
        model: response.model,
      },
      'Indirect request classification complete',
    );

    return isForJarvis
      ? { isForJarvis: true, trigger: 'indirect' }
      : { isForJarvis: false };
  } catch (err) {
    logger.warn(
      { err, messageId: message.id },
      'Indirect request classifier failed — treating as non-request',
    );
    return { isForJarvis: false };
  }
}

/**
 * Strip the bot mention from message content and return the normalised
 * request text.  For replies and indirect triggers the content is
 * returned as-is (after trimming).
 */
export function extractRequestText(
  message: Message,
  botUserId: string,
): string {
  let text = message.content;
  // Remove <@botUserId> and <@!botUserId> patterns (bot mention)
  text = text.replace(new RegExp(`<@!?${botUserId}>`, 'g'), '');
  return text.trim();
}

// ── Internal helpers ───────────────────────────────────────────────────

/** The message directly @mentions the bot user. */
function isDirectMention(message: Message, botUserId: string): boolean {
  return message.mentions.users.has(botUserId);
}

/**
 * The message is a reply to a message authored by the bot user.
 * Uses `message.mentions.repliedUser` which discord.js populates for all
 * reply messages regardless of whether the reply pings the author.
 */
function isReplyToBot(message: Message, botUserId: string): boolean {
  return message.mentions.repliedUser?.id === botUserId;
}

/**
 * Conservative indirect-request classification.
 *
 * This is intentionally a no-op placeholder that always returns `false`.
 * A future task will wire LLM-based classification with a configurable
 * confidence threshold and low-confidence fallback policy.
 */
function isIndirectRequest(_message: Message): boolean {
  // TODO(6.1): Wire LLM-based indirect request classification
  return false;
}
