import {
  PermissionFlagsBits,
  type Guild,
  type GuildMember,
} from 'discord.js';
import type {
  JoinVoiceIntent,
  SendTextMessageIntent,
  MoveMemberIntent,
  MuteMemberIntent,
  DeafenMemberIntent,
  RenameMemberIntent,
} from '../interaction/intent.js';
import type { InteractionContext } from '../interaction/types.js';
import type { ActionResult } from './types.js';
import {
  resolveVoiceChannel,
  resolveTextChannel,
  resolveDefaultTextChannel,
  resolveMember,
} from './resolve.js';
import { formatResolveError } from './errors.js';
import { joinAndListen } from '../voice/connection.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('action-handlers');

// ── Join voice channel ──────────────────────────────────────────────

export async function handleJoinVoice(
  ctx: InteractionContext,
  intent: JoinVoiceIntent,
  guild: Guild,
  botMember: GuildMember,
): Promise<ActionResult> {
  const resolved = await resolveVoiceChannel(guild, intent.channelRef);
  if (resolved.status !== 'found') {
    return formatResolveError('voice channel', resolved);
  }

  const channel = resolved.value;

  // Permission check
  const perms = channel.permissionsFor(botMember);
  if (!perms?.has(PermissionFlagsBits.Connect)) {
    return {
      success: false,
      targetChannelId: channel.id,
      message: `I don't have permission to connect to **${channel.name}**.`,
    };
  }
  if (!perms?.has(PermissionFlagsBits.Speak)) {
    return {
      success: false,
      targetChannelId: channel.id,
      message: `I don't have permission to speak in **${channel.name}**.`,
    };
  }

  try {
    await joinAndListen(guild.id, channel.id, guild.voiceAdapterCreator);
    return {
      success: true,
      targetChannelId: channel.id,
      message: `Joined **${channel.name}**.`,
    };
  } catch (err) {
    return {
      success: false,
      targetChannelId: channel.id,
      message: `Failed to join **${channel.name}**: ${errorMessage(err)}`,
    };
  }
}

// ── Send text message ───────────────────────────────────────────────

export async function handleSendTextMessage(
  ctx: InteractionContext,
  intent: SendTextMessageIntent,
  guild: Guild,
  botMember: GuildMember,
): Promise<ActionResult> {
  let channel;

  if (intent.channelRef) {
    const resolved = await resolveTextChannel(guild, intent.channelRef);
    if (resolved.status !== 'found') {
      return formatResolveError('text channel', resolved);
    }
    channel = resolved.value;
  } else {
    channel = resolveDefaultTextChannel(guild);
    if (!channel) {
      return {
        success: false,
        message: 'I could not find a default text channel in this server.',
      };
    }
    logger.info(
      {
        correlationId: ctx.correlationId,
        surface: ctx.surface,
        resolvedChannel: channel.name,
        resolvedChannelId: channel.id,
      },
      'Resolved default text channel for send-text-message',
    );
  }

  const perms = channel.permissionsFor(botMember);
  if (!perms?.has(PermissionFlagsBits.SendMessages)) {
    return {
      success: false,
      targetChannelId: channel.id,
      message: `I don't have permission to send messages in **#${channel.name}**.`,
    };
  }

  try {
    await channel.send(intent.message);
    return {
      success: true,
      targetChannelId: channel.id,
      message: `Message sent in **#${channel.name}**.`,
    };
  } catch (err) {
    return {
      success: false,
      targetChannelId: channel.id,
      message: `Failed to send message in **#${channel.name}**: ${errorMessage(err)}`,
    };
  }
}

// ── Move member ─────────────────────────────────────────────────────

export async function handleMoveMember(
  ctx: InteractionContext,
  intent: MoveMemberIntent,
  guild: Guild,
  botMember: GuildMember,
): Promise<ActionResult> {
  const [memberResult, channelResult] = await Promise.all([
    resolveMember(guild, intent.targetRef),
    resolveVoiceChannel(guild, intent.destinationRef),
  ]);

  if (memberResult.status !== 'found') {
    return formatResolveError('member', memberResult);
  }
  if (channelResult.status !== 'found') {
    return formatResolveError('voice channel', channelResult);
  }

  const target = memberResult.value;
  const destination = channelResult.value;

  if (!target.voice.channel) {
    return {
      success: false,
      targetMemberId: target.id,
      targetChannelId: destination.id,
      message: `**${target.displayName}** is not in a voice channel.`,
    };
  }

  const perms = destination.permissionsFor(botMember);
  if (!perms?.has(PermissionFlagsBits.MoveMembers)) {
    return {
      success: false,
      targetMemberId: target.id,
      targetChannelId: destination.id,
      message: `I don't have permission to move members to **${destination.name}**.`,
    };
  }

  try {
    await target.voice.setChannel(destination);
    return {
      success: true,
      targetMemberId: target.id,
      targetChannelId: destination.id,
      message: `Moved **${target.displayName}** to **${destination.name}**.`,
    };
  } catch (err) {
    return {
      success: false,
      targetMemberId: target.id,
      targetChannelId: destination.id,
      message: `Failed to move **${target.displayName}**: ${errorMessage(err)}`,
    };
  }
}

// ── Mute member ─────────────────────────────────────────────────────

export async function handleMuteMember(
  ctx: InteractionContext,
  intent: MuteMemberIntent,
  guild: Guild,
  botMember: GuildMember,
): Promise<ActionResult> {
  const resolved = await resolveMember(guild, intent.targetRef);
  if (resolved.status !== 'found') {
    return formatResolveError('member', resolved);
  }

  const target = resolved.value;
  if (!target.voice.channel) {
    return {
      success: false,
      targetMemberId: target.id,
      message: `**${target.displayName}** is not in a voice channel.`,
    };
  }

  const perms = target.voice.channel.permissionsFor(botMember);
  if (!perms?.has(PermissionFlagsBits.MuteMembers)) {
    return {
      success: false,
      targetMemberId: target.id,
      message: `I don't have permission to ${intent.mute ? 'mute' : 'unmute'} members.`,
    };
  }

  const verb = intent.mute ? 'muted' : 'unmuted';
  try {
    await target.voice.setMute(intent.mute);
    return {
      success: true,
      targetMemberId: target.id,
      message: `**${target.displayName}** has been ${verb}.`,
    };
  } catch (err) {
    return {
      success: false,
      targetMemberId: target.id,
      message: `Failed to ${verb.slice(0, -1)} **${target.displayName}**: ${errorMessage(err)}`,
    };
  }
}

// ── Deafen member ───────────────────────────────────────────────────

export async function handleDeafenMember(
  ctx: InteractionContext,
  intent: DeafenMemberIntent,
  guild: Guild,
  botMember: GuildMember,
): Promise<ActionResult> {
  const resolved = await resolveMember(guild, intent.targetRef);
  if (resolved.status !== 'found') {
    return formatResolveError('member', resolved);
  }

  const target = resolved.value;
  if (!target.voice.channel) {
    return {
      success: false,
      targetMemberId: target.id,
      message: `**${target.displayName}** is not in a voice channel.`,
    };
  }

  const perms = target.voice.channel.permissionsFor(botMember);
  if (!perms?.has(PermissionFlagsBits.DeafenMembers)) {
    return {
      success: false,
      targetMemberId: target.id,
      message: `I don't have permission to ${intent.deafen ? 'deafen' : 'undeafen'} members.`,
    };
  }

  const verb = intent.deafen ? 'deafened' : 'undeafened';
  try {
    await target.voice.setDeaf(intent.deafen);
    return {
      success: true,
      targetMemberId: target.id,
      message: `**${target.displayName}** has been ${verb}.`,
    };
  } catch (err) {
    return {
      success: false,
      targetMemberId: target.id,
      message: `Failed to ${verb.slice(0, -1)} **${target.displayName}**: ${errorMessage(err)}`,
    };
  }
}

// ── Rename member ───────────────────────────────────────────────────

export async function handleRenameMember(
  ctx: InteractionContext,
  intent: RenameMemberIntent,
  guild: Guild,
  botMember: GuildMember,
): Promise<ActionResult> {
  const resolved = await resolveMember(guild, intent.targetRef);
  if (resolved.status !== 'found') {
    return formatResolveError('member', resolved);
  }

  const target = resolved.value;

  // Permission check — bot needs ManageNicknames
  if (!botMember.permissions.has(PermissionFlagsBits.ManageNicknames)) {
    return {
      success: false,
      targetMemberId: target.id,
      message: "I don't have the **Manage Nicknames** permission in this server.",
    };
  }

  // Role hierarchy — bot's highest role must be above target's highest role
  if (
    target.id !== botMember.id &&
    botMember.roles.highest.position <= target.roles.highest.position
  ) {
    return {
      success: false,
      targetMemberId: target.id,
      message: `I can't change **${target.displayName}**'s nickname because their role is equal to or higher than mine.`,
    };
  }

  // Server owner cannot have nickname changed by bots
  if (target.id === guild.ownerId) {
    return {
      success: false,
      targetMemberId: target.id,
      message: `I can't change the server owner's nickname.`,
    };
  }

  // Nickname length validation (Discord limit: 1–32 characters)
  if (intent.newName.length < 1 || intent.newName.length > 32) {
    return {
      success: false,
      targetMemberId: target.id,
      message: `Nicknames must be between 1 and 32 characters long.`,
    };
  }

  try {
    await target.setNickname(intent.newName);
    return {
      success: true,
      targetMemberId: target.id,
      message: `Renamed **${target.user.username}** to **${intent.newName}**.`,
    };
  } catch (err) {
    return {
      success: false,
      targetMemberId: target.id,
      message: `Failed to rename **${target.displayName}**: ${errorMessage(err)}`,
    };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
