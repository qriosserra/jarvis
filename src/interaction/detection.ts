import type { Message } from 'discord.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('detection');

// ── Detection result ───────────────────────────────────────────────────

export type TextDetectionResult =
  | { isForJarvis: false }
  | { isForJarvis: true; trigger: 'mention' | 'reply' | 'indirect' };

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
