import type { GuildMember } from 'discord.js';
import type { SpeakerUtterance } from './types.js';
import type { InteractionContext } from '../interaction/types.js';
import { handleInteraction } from '../interaction/orchestrator.js';
import { runWithCorrelationId, getCorrelationId } from '../lib/correlation.js';
import { getContainer } from '../container.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('speech-detect');

// ── Bot name variants for addressed-speech detection ────────────────

const DEFAULT_BOT_NAMES = ['jarvis'];

/**
 * Check whether a transcript is naturally addressed to Jarvis.
 *
 * Looks for the bot's name or configured aliases at the start of or
 * within the transcript.  This is a simple heuristic — task 6.1 may
 * augment it with LLM-based classification.
 */
export function isAddressedToJarvis(
  transcript: string,
  botNames: string[] = DEFAULT_BOT_NAMES,
): boolean {
  const lower = transcript.toLowerCase();

  for (const name of botNames) {
    const nameLower = name.toLowerCase();

    // "Jarvis, ..." or "Hey Jarvis ..."
    if (lower.startsWith(nameLower)) return true;

    // "... Jarvis" at word boundaries
    const idx = lower.indexOf(nameLower);
    if (idx >= 0) {
      const before = idx === 0 || /\s/.test(lower[idx - 1]);
      const after =
        idx + nameLower.length >= lower.length ||
        /[\s,?.!]/.test(lower[idx + nameLower.length]);
      if (before && after) return true;
    }
  }

  return false;
}

/**
 * Strip the bot name prefix from the transcript to get the raw request text.
 */
export function stripBotNamePrefix(
  transcript: string,
  botNames: string[] = DEFAULT_BOT_NAMES,
): string {
  let text = transcript;
  const lower = text.toLowerCase();

  for (const name of botNames) {
    const nameLower = name.toLowerCase();
    if (lower.startsWith(nameLower)) {
      text = text.slice(name.length).replace(/^[\s,]+/, '');
      break;
    }
    // Also handle "hey jarvis", "ok jarvis", "yo jarvis"
    for (const prefix of ['hey ', 'ok ', 'yo ', 'hi ']) {
      if (lower.startsWith(prefix + nameLower)) {
        text = text.slice(prefix.length + name.length).replace(/^[\s,]+/, '');
        break;
      }
    }
  }

  return text.trim();
}

// ── Speaker attribution ─────────────────────────────────────────────

/**
 * Resolve the guild member from a Discord user ID.
 *
 * Returns `null` when the member cannot be confidently attributed —
 * the caller must decline to execute risky actions in that case.
 */
export async function attributeSpeaker(
  userId: string,
  guildId: string,
): Promise<GuildMember | null> {
  try {
    const container = getContainer();
    const guild = await container.discord.guilds.fetch(guildId);
    const member = await guild.members.fetch(userId);
    return member ?? null;
  } catch (err) {
    logger.warn({ userId, guildId, err }, 'Failed to attribute speaker');
    return null;
  }
}

// ── Voice utterance → interaction pipeline ──────────────────────────

/**
 * Handle a completed voice utterance: check if addressed, attribute
 * the speaker, and route into the shared interaction orchestrator.
 *
 * Registered as the `onUtterance` callback in the connection manager.
 */
export async function handleVoiceUtterance(utterance: SpeakerUtterance): Promise<void> {
  const { userId, guildId, channelId, transcript } = utterance;

  if (!isAddressedToJarvis(transcript)) {
    logger.debug({ guildId, userId }, 'Unaddressed speech, ignoring');
    return;
  }

  logger.info(
    { guildId, userId, transcript: transcript.slice(0, 120) },
    'Addressed speech detected',
  );

  const speaker = await attributeSpeaker(userId, guildId);
  if (!speaker) {
    logger.warn(
      { guildId, userId },
      'Cannot attribute speaker, declining to execute',
    );
    return;
  }

  const requestText = stripBotNamePrefix(transcript);
  if (!requestText) return;

  const container = getContainer();

  await runWithCorrelationId(async () => {
    const ctx: InteractionContext = {
      correlationId: getCorrelationId()!,
      guildId,
      guildName: speaker.guild.name,
      channelId,
      surface: 'voice',
      requester: {
        id: speaker.id,
        username: speaker.user.username,
        displayName: speaker.displayName,
      },
      requestText,
      language: utterance.language,
      personaId: container.config.persona.default,
      trigger: 'voice-addressed',
      timestamp: new Date(),
    };

    logger.info(
      {
        correlationId: ctx.correlationId,
        guildId,
        trigger: ctx.trigger,
        requester: ctx.requester.id,
      },
      'Voice interaction detected',
    );

    await handleInteraction(ctx);
  });
}
