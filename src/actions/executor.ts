import type { Guild, GuildMember, TextChannel } from 'discord.js';
import { IntentKind, type IntentOutcome } from '../interaction/intent.js';
import type { InteractionContext } from '../interaction/types.js';
import type { ActionResult } from './types.js';
import {
  handleJoinVoice,
  handleSendTextMessage,
  handleMoveMember,
  handleMuteMember,
  handleDeafenMember,
  handleRenameMember,
} from './handlers.js';
import { createLogger } from '../lib/logger.js';
import { trackOperation } from '../lib/latency-tracker.js';
import { OperationName, OperationType } from '../lib/operation-constants.js';
import { getContainer, getDiscordClient } from '../container.js';
import { persistActionOutcomeMemory } from '../memory/persist.js';
import { checkMemorySafety } from '../memory/safety.js';
import { actionOutcomeCounter } from '../lib/metrics.js';

const logger = createLogger('action-executor');

/**
 * Execute a deterministic guild action for the given intent.
 *
 * 1. Resolves guild + bot member from context
 * 2. Dispatches to the appropriate handler
 * 3. Sends the result message back to the requester
 * 4. Records the action outcome in the database
 */
export async function executeAction(
  ctx: InteractionContext,
  intent: IntentOutcome,
): Promise<ActionResult> {
  // CLI / headless simulation — return descriptive results without Discord
  if (ctx.simulateActions) {
    const result = simulateAction(intent);
    return sendAndRecord(ctx, intent, result);
  }

  const discord = getDiscordClient();
  const guild = await discord.guilds.fetch(ctx.guildId);
  if (!guild) {
    return sendAndRecord(ctx, intent, {
      success: false,
      message: 'Could not resolve the server for this request.',
    });
  }

  const botMember = await guild.members.fetchMe();
  if (!botMember) {
    return sendAndRecord(ctx, intent, {
      success: false,
      message: 'Could not resolve my own membership in this server.',
    });
  }

  // Memory safety gate — check identity data before risky actions
  const safetyCheck = await checkMemorySafety(ctx, intent);
  if (!safetyCheck.safe) {
    return sendAndRecord(ctx, intent, {
      success: false,
      message: safetyCheck.reason ?? 'I need more information before I can do that.',
    });
  }

  const dispatchHandler = async (): Promise<ActionResult> => {
    switch (intent.kind) {
      case IntentKind.JoinVoice:
        return handleJoinVoice(ctx, intent, guild, botMember);
      case IntentKind.SendTextMessage:
        return handleSendTextMessage(ctx, intent, guild, botMember);
      case IntentKind.MoveMember:
        return handleMoveMember(ctx, intent, guild, botMember);
      case IntentKind.MuteMember:
        return handleMuteMember(ctx, intent, guild, botMember);
      case IntentKind.DeafenMember:
        return handleDeafenMember(ctx, intent, guild, botMember);
      case IntentKind.RenameMember:
        return handleRenameMember(ctx, intent, guild, botMember);
      default:
        return {
          success: false,
          message: `Unknown action type: ${(intent as IntentOutcome).kind}`,
        };
    }
  };

  const { result } = await trackOperation(
    {
      operationName: `${OperationName.ACTION_PREFIX}${intent.kind}`,
      operationType: OperationType.PIPELINE,
      context: {
        correlationId: ctx.correlationId,
        guildId: ctx.guildId,
        memberId: ctx.requester.id,
        interactionId: ctx.interactionId,
      },
      metadata: { intentKind: intent.kind },
    },
    dispatchHandler,
  );

  return sendAndRecord(ctx, intent, result);
}

// ── Reply delivery ──────────────────────────────────────────────────

async function sendReply(ctx: InteractionContext, message: string): Promise<void> {
  // CLI / headless — deliver via the injected reply handler
  if (ctx.replyHandler) {
    await ctx.replyHandler(message);
    return;
  }

  // Text surface — reply to the source message or send in the originating channel
  if (ctx.sourceMessage) {
    try {
      await ctx.sourceMessage.reply(message);
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
      await (channel as TextChannel).send(message);
    }
  } catch (err) {
    logger.error(
      { correlationId: ctx.correlationId, err },
      'Failed to send action result to channel',
    );
  }
}

// ── Simulated action results ─────────────────────────────────────────

function simulateAction(intent: IntentOutcome): ActionResult {
  switch (intent.kind) {
    case IntentKind.JoinVoice:
      return { success: true, message: `[simulated] Would join voice channel "${intent.channelRef}".` };
    case IntentKind.SendTextMessage:
      return { success: true, targetChannelId: intent.channelRef, message: `[simulated] Would send message to ${intent.channelRef ? `#${intent.channelRef}` : 'default channel'}: "${intent.message}"` };
    case IntentKind.MoveMember:
      return { success: true, message: `[simulated] Would move "${intent.targetRef}" to "${intent.destinationRef}".` };
    case IntentKind.MuteMember:
      return { success: true, message: `[simulated] Would ${intent.mute ? 'mute' : 'unmute'} "${intent.targetRef}".` };
    case IntentKind.DeafenMember:
      return { success: true, message: `[simulated] Would ${intent.deafen ? 'deafen' : 'undeafen'} "${intent.targetRef}".` };
    case IntentKind.RenameMember:
      return { success: true, message: `[simulated] Would rename "${intent.targetRef}" to "${intent.newName}".` };
    default:
      return { success: false, message: `[simulated] Unknown action: ${(intent as IntentOutcome).kind}` };
  }
}

// ── Outcome persistence ─────────────────────────────────────────────

async function sendAndRecord(
  ctx: InteractionContext,
  intent: IntentOutcome,
  result: ActionResult,
): Promise<ActionResult> {
  actionOutcomeCounter.add(1, {
    kind: intent.kind,
    success: String(result.success),
  });

  logger.info(
    {
      correlationId: ctx.correlationId,
      intentKind: intent.kind,
      success: result.success,
      targetMemberId: result.targetMemberId,
      targetChannelId: result.targetChannelId,
    },
    result.success ? 'Action succeeded' : 'Action failed',
  );

  // Send reply to user
  await sendReply(ctx, result.message);

  // Reuse early-created interaction row; backfill response text and persist outcome
  const interactionId = ctx.interactionId;
  try {
    const container = getContainer();

    // Backfill response text on the early-created interaction row
    if (interactionId) {
      await container.repos.interactions.update(interactionId, { responseText: result.message });
    }

    if (interactionId) {
      await container.repos.actionOutcomes.create({
        interactionId,
        guildId: ctx.guildId,
        actionType: intent.kind,
        targetMemberId: result.targetMemberId ?? null,
        targetChannelId: result.targetChannelId ?? null,
        success: result.success,
        errorMessage: result.success ? null : result.message,
      });
    }
  } catch (err) {
    logger.warn(
      { correlationId: ctx.correlationId, err },
      'Failed to persist action outcome',
    );
  }

  // Persist as a memory record for future context (non-blocking)
  if (!ctx.skipMemoryPersistence) {
    const memoryTask = persistActionOutcomeMemory(ctx, intent.kind, result.success, result.message, interactionId).catch(() => {});
    if (ctx.backgroundTasks) {
      ctx.backgroundTasks.push(memoryTask);
    }
  }

  return result;
}
