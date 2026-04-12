import type { GuildMember } from 'discord.js';
import type { InteractionContext } from '../interaction/types.js';
import type { IdentityAlias } from '../db/types.js';
import { getContainer } from '../container.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('memory-identity');

// ── Discord-derived name ingestion ──────────────────────────────────

/**
 * Ingest the current Discord-derived names for a guild member.
 *
 * Stores or updates:
 * - username (global, guild_id = null)
 * - nickname (guild-scoped, if the member has one)
 *
 * Called during interaction processing so identity records stay fresh.
 */
export async function ingestDiscordNames(
  member: GuildMember,
  guildId: string,
): Promise<void> {
  const container = getContainer();
  const repo = container.repos.identityAliases;

  try {
    // Username — global scope (no guildId)
    await repo.upsert({
      memberId: member.id,
      guildId: null,
      aliasType: 'username',
      value: member.user.username,
      source: 'discord',
      confidence: 1.0,
      confirmed: true,
    });

    // Guild nickname — guild-scoped
    if (member.nickname) {
      await repo.upsert({
        memberId: member.id,
        guildId,
        aliasType: 'nickname',
        value: member.nickname,
        source: 'discord',
        confidence: 1.0,
        confirmed: true,
      });
    }

    logger.debug(
      { memberId: member.id, guildId, username: member.user.username, nickname: member.nickname },
      'Discord names ingested',
    );
  } catch (err) {
    logger.warn(
      { memberId: member.id, guildId, err },
      'Failed to ingest Discord names',
    );
  }
}

/**
 * Ingest Discord names from an InteractionContext's requester.
 * Simpler version when we only have the requester info, not a full GuildMember.
 */
export async function ingestRequesterNames(ctx: InteractionContext): Promise<void> {
  const container = getContainer();
  const repo = container.repos.identityAliases;

  try {
    const membershipId = ctx.membershipId ?? null;

    // Username — global
    await repo.upsert({
      memberId: ctx.requester.id,
      membershipId,
      guildId: null,
      aliasType: 'username',
      value: ctx.requester.username,
      source: 'discord',
      confidence: 1.0,
      confirmed: true,
    });

    // Display name as nickname — guild-scoped (if different from username)
    if (ctx.requester.displayName && ctx.requester.displayName !== ctx.requester.username) {
      await repo.upsert({
        memberId: ctx.requester.id,
        membershipId,
        guildId: ctx.guildId,
        aliasType: 'nickname',
        value: ctx.requester.displayName,
        source: 'discord',
        confidence: 1.0,
        confirmed: true,
      });
    }
  } catch (err) {
    logger.warn(
      { memberId: ctx.requester.id, guildId: ctx.guildId, err },
      'Failed to ingest requester names',
    );
  }
}

// ── Explicit name confirmation ──────────────────────────────────────

/**
 * Store an explicitly provided or confirmed preferred name.
 *
 * This is used when a member says something like "call me Alex" or
 * "my name is Alex" and the system confirms it.
 */
export async function storeConfirmedPreferredName(
  memberId: string,
  guildId: string | null,
  name: string,
  aliasType: 'preferred_name' | 'first_name' = 'preferred_name',
): Promise<IdentityAlias> {
  const container = getContainer();

  const alias = await container.repos.identityAliases.upsert({
    memberId,
    guildId,
    aliasType,
    value: name,
    source: 'explicit',
    confidence: 1.0,
    confirmed: true,
  });

  logger.info(
    { memberId, guildId, aliasType, name },
    'Confirmed preferred name stored',
  );

  return alias;
}

// ── Name selection ──────────────────────────────────────────────────

/**
 * Select the best known name for a member in a guild context.
 *
 * Priority:
 * 1. Confirmed preferred_name (guild-scoped, then global)
 * 2. Confirmed first_name (guild-scoped, then global)
 * 3. Guild nickname
 * 4. Username
 *
 * Returns the selected name or null if no identity data exists.
 */
export async function selectBestName(
  memberId: string,
  guildId: string,
): Promise<{ name: string; aliasType: string; confidence: number } | null> {
  const container = getContainer();
  const aliases = await container.repos.identityAliases.findByMember(memberId, { guildId });

  if (aliases.length === 0) return null;

  // Priority ordering
  const priority: Record<string, number> = {
    preferred_name: 0,
    first_name: 1,
    nickname: 2,
    username: 3,
  };

  // Sort by: confirmed first, then priority, then guild-scoped first, then confidence
  const sorted = aliases.sort((a, b) => {
    if (a.confirmed !== b.confirmed) return a.confirmed ? -1 : 1;
    const pa = priority[a.aliasType] ?? 99;
    const pb = priority[b.aliasType] ?? 99;
    if (pa !== pb) return pa - pb;
    // Prefer guild-scoped over global
    if (a.guildId && !b.guildId) return -1;
    if (!a.guildId && b.guildId) return 1;
    return b.confidence - a.confidence;
  });

  const best = sorted[0];
  return {
    name: best.value,
    aliasType: best.aliasType,
    confidence: best.confidence,
  };
}

/**
 * Get all known names for a member, grouped by type.
 * Useful for conflict detection and clarification prompts.
 */
export async function getAllKnownNames(
  memberId: string,
  guildId: string,
): Promise<IdentityAlias[]> {
  const container = getContainer();
  return container.repos.identityAliases.findByMember(memberId, { guildId });
}
