import {
  ChannelType,
  type Guild,
  type GuildMember,
  type GuildBasedChannel,
  type TextChannel,
  type VoiceChannel,
} from 'discord.js';
import type { ResolveResult } from './types.js';

// ── Channel resolution ──────────────────────────────────────────────

const CHANNEL_MENTION_RE = /^<#(\d+)>$/;

/**
 * Resolve a human-readable or ID reference to a single voice channel.
 * Returns ambiguous when multiple channels match.
 */
export async function resolveVoiceChannel(
  guild: Guild,
  ref: string,
): Promise<ResolveResult<VoiceChannel>> {
  const channels = guild.channels.cache;

  // Direct ID or mention
  const mentionMatch = CHANNEL_MENTION_RE.exec(ref);
  const directId = mentionMatch?.[1] ?? ref;
  const byId = channels.get(directId);
  if (byId && isVoiceChannel(byId)) {
    return { status: 'found', value: byId };
  }

  // Name match (case-insensitive)
  const lower = ref.toLowerCase();
  const matches = channels.filter(
    (ch): ch is VoiceChannel =>
      isVoiceChannel(ch) && ch.name.toLowerCase() === lower,
  );
  if (matches.size === 1) return { status: 'found', value: matches.first()! };
  if (matches.size > 1) {
    return { status: 'ambiguous', matches: [...matches.values()], label: ref };
  }

  // Partial / substring match
  const partial = channels.filter(
    (ch): ch is VoiceChannel =>
      isVoiceChannel(ch) && ch.name.toLowerCase().includes(lower),
  );
  if (partial.size === 1) return { status: 'found', value: partial.first()! };
  if (partial.size > 1) {
    return { status: 'ambiguous', matches: [...partial.values()], label: ref };
  }

  return { status: 'not-found', label: ref };
}

/**
 * Resolve a human-readable or ID reference to a single text channel.
 * Returns ambiguous when multiple channels match.
 */
export async function resolveTextChannel(
  guild: Guild,
  ref: string,
): Promise<ResolveResult<TextChannel>> {
  const channels = guild.channels.cache;

  // Direct ID or mention
  const mentionMatch = CHANNEL_MENTION_RE.exec(ref);
  const directId = mentionMatch?.[1] ?? ref;
  const byId = channels.get(directId);
  if (byId && isTextChannel(byId)) {
    return { status: 'found', value: byId };
  }

  // Exact name match (case-insensitive)
  const lower = ref.toLowerCase();
  const matches = channels.filter(
    (ch): ch is TextChannel =>
      isTextChannel(ch) && ch.name.toLowerCase() === lower,
  );
  if (matches.size === 1) return { status: 'found', value: matches.first()! };
  if (matches.size > 1) {
    return { status: 'ambiguous', matches: [...matches.values()], label: ref };
  }

  // Partial match
  const partial = channels.filter(
    (ch): ch is TextChannel =>
      isTextChannel(ch) && ch.name.toLowerCase().includes(lower),
  );
  if (partial.size === 1) return { status: 'found', value: partial.first()! };
  if (partial.size > 1) {
    return { status: 'ambiguous', matches: [...partial.values()], label: ref };
  }

  return { status: 'not-found', label: ref };
}

/**
 * Resolve the guild's default general text channel.
 * Prefers: system channel → channel named "general" → first sendable text channel.
 */
export function resolveDefaultTextChannel(guild: Guild): TextChannel | null {
  if (guild.systemChannel && isTextChannel(guild.systemChannel)) {
    return guild.systemChannel as TextChannel;
  }
  const general = guild.channels.cache.find(
    (ch): ch is TextChannel =>
      isTextChannel(ch) && ch.name.toLowerCase() === 'general',
  );
  if (general) return general;

  return (
    guild.channels.cache.find(
      (ch): ch is TextChannel => isTextChannel(ch),
    ) ?? null
  );
}

// ── Member resolution ───────────────────────────────────────────────

const MEMBER_MENTION_RE = /^<@!?(\d+)>$/;

/**
 * Resolve a human-readable or ID reference to a single guild member.
 * Returns ambiguous when multiple members match.
 */
export async function resolveMember(
  guild: Guild,
  ref: string,
): Promise<ResolveResult<GuildMember>> {
  // Direct ID or mention
  const mentionMatch = MEMBER_MENTION_RE.exec(ref);
  const directId = mentionMatch?.[1] ?? ref;
  try {
    const byId = await guild.members.fetch(directId);
    if (byId) return { status: 'found', value: byId };
  } catch {
    // Not a valid ID — continue with name matching
  }

  // Ensure member cache is reasonably populated
  await guild.members.fetch().catch(() => {});

  const lower = ref.toLowerCase();
  const matches = guild.members.cache.filter((m) => {
    const nick = m.nickname?.toLowerCase();
    const display = m.displayName.toLowerCase();
    const user = m.user.username.toLowerCase();
    const global = m.user.globalName?.toLowerCase();
    return (
      nick === lower ||
      display === lower ||
      user === lower ||
      global === lower
    );
  });

  if (matches.size === 1) return { status: 'found', value: matches.first()! };
  if (matches.size > 1) {
    return { status: 'ambiguous', matches: [...matches.values()], label: ref };
  }

  // Partial match
  const partial = guild.members.cache.filter((m) => {
    const nick = m.nickname?.toLowerCase() ?? '';
    const display = m.displayName.toLowerCase();
    const user = m.user.username.toLowerCase();
    const global = m.user.globalName?.toLowerCase() ?? '';
    return (
      nick.includes(lower) ||
      display.includes(lower) ||
      user.includes(lower) ||
      global.includes(lower)
    );
  });

  if (partial.size === 1) return { status: 'found', value: partial.first()! };
  if (partial.size > 1) {
    return { status: 'ambiguous', matches: [...partial.values()], label: ref };
  }

  return { status: 'not-found', label: ref };
}

// ── Helpers ─────────────────────────────────────────────────────────

function isVoiceChannel(ch: GuildBasedChannel): ch is VoiceChannel {
  return (
    ch.type === ChannelType.GuildVoice ||
    ch.type === ChannelType.GuildStageVoice
  );
}

function isTextChannel(ch: GuildBasedChannel): ch is TextChannel {
  return ch.type === ChannelType.GuildText;
}
