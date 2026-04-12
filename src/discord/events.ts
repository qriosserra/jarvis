import type { Client, Message, VoiceState } from 'discord.js';
import { createLogger } from '../lib/logger.js';
import { runWithCorrelationId, getCorrelationId } from '../lib/correlation.js';
import { detectTextRequest, extractRequestText } from '../interaction/detection.js';
import { handleInteraction } from '../interaction/orchestrator.js';
import { getContainer } from '../container.js';
import type { InteractionContext } from '../interaction/types.js';
import { setUtteranceHandler } from '../voice/connection.js';
import { handleVoiceUtterance } from '../voice/speech-detect.js';

const logger = createLogger('discord-events');

/**
 * Register all gateway event handlers on the Discord client.
 * Called once after the client is created but before login.
 */
export function registerEventHandlers(client: Client): void {
  client.on('messageCreate', (message) => {
    runWithCorrelationId(async () => {
      try {
        await onMessageCreate(message);
      } catch (err) {
        logger.error({ err, messageId: message.id }, 'Unhandled error in messageCreate handler');
      }
    });
  });

  client.on('voiceStateUpdate', (oldState, newState) => {
    try {
      onVoiceStateUpdate(oldState, newState);
    } catch (err) {
      logger.error({ err }, 'Unhandled error in voiceStateUpdate handler');
    }
  });

  logger.info('Gateway event handlers registered');
}

// ── Text-surface handler ───────────────────────────────────────────────

async function onMessageCreate(message: Message): Promise<void> {
  // Ignore bots (including self) and DMs
  if (message.author.bot) return;
  if (!message.guild) return;
  if (!message.member) return;

  const container = getContainer();
  const botUserId = container.discord.user?.id;
  if (!botUserId) return;

  const detection = detectTextRequest(message, botUserId);
  if (!detection.isForJarvis) return;

  const requestText = extractRequestText(message, botUserId);
  if (!requestText) return; // empty after stripping mention

  const ctx: InteractionContext = {
    correlationId: getCorrelationId()!,
    guildId: message.guild.id,
    guildName: message.guild.name,
    channelId: message.channel.id,
    surface: 'text',
    requester: {
      id: message.member.id,
      username: message.author.username,
      displayName: message.member.displayName,
    },
    requestText,
    trigger: detection.trigger,
    personaId: container.config.persona.default,
    sourceMessage: message,
    timestamp: message.createdAt,
  };

  logger.info(
    {
      correlationId: ctx.correlationId,
      guildId: ctx.guildId,
      trigger: ctx.trigger,
      requester: ctx.requester.id,
    },
    'Text interaction detected',
  );

  await handleInteraction(ctx);
}

// ── Voice-state handler ─────────────────────────────────────────────

function onVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): void {
  const container = getContainer();
  const botId = container.discord.user?.id;
  if (!botId) return;

  // Only interested in our own voice state changes
  if (newState.id !== botId) return;

  const guildId = newState.guild.id;

  if (newState.channelId && newState.channelId !== oldState.channelId) {
    // Bot joined or moved to a new voice channel — ensure utterance handler is wired
    logger.info(
      { guildId, channelId: newState.channelId },
      'Bot voice channel changed, wiring utterance handler',
    );
    setUtteranceHandler(guildId, handleVoiceUtterance);
  }

  if (!newState.channelId && oldState.channelId) {
    // Bot left a voice channel
    logger.info({ guildId }, 'Bot left voice channel');
  }
}
