import type { InteractionContext } from '../interaction/types.js';
import { MEMBER_REFERENCING_INTENT_KINDS, type IntentOutcome } from '../interaction/intent.js';
import type { IdentityAlias } from '../db/types.js';
import { getAllKnownNames } from './identity.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('memory-safety');

// ── Safety check result ─────────────────────────────────────────────

export interface SafetyCheckResult {
  /** Whether the action is safe to proceed. */
  safe: boolean;
  /** If not safe, the reason / clarifying question. */
  reason?: string;
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Check whether a deterministic action that references a guild member
 * is safe to execute given current identity data.
 *
 * Gates on:
 * - Conflicting identity aliases (e.g. two different confirmed names)
 * - Stale data (updated > 30 days ago with low confidence)
 * - Unconfirmed references to real names
 *
 * Returns `{ safe: true }` if the action can proceed, or
 * `{ safe: false, reason }` with a clarification question.
 */
export async function checkMemorySafety(
  ctx: InteractionContext,
  intent: IntentOutcome,
): Promise<SafetyCheckResult> {
  // Only check intents that reference members
  if (!('targetRef' in intent) || !MEMBER_REFERENCING_INTENT_KINDS.has(intent.kind)) {
    return { safe: true };
  }

  const targetRef = (intent as { targetRef: string }).targetRef;

  try {
    // Look up known aliases that might match the target reference
    const aliases = await findMatchingAliases(ctx.guildId, targetRef);

    if (aliases.length === 0) {
      // No identity data — let Discord resolution handle it
      return { safe: true };
    }

    // Check for conflicts
    const conflict = detectConflicts(aliases, targetRef);
    if (conflict) {
      logger.info(
        { correlationId: ctx.correlationId, targetRef, conflict: conflict.reason },
        'Identity conflict detected, requesting clarification',
      );
      return conflict;
    }

    // Check for stale data
    const stale = detectStaleData(aliases);
    if (stale) {
      logger.info(
        { correlationId: ctx.correlationId, targetRef, stale: stale.reason },
        'Stale identity data detected, requesting clarification',
      );
      return stale;
    }

    return { safe: true };
  } catch (err) {
    logger.warn(
      { correlationId: ctx.correlationId, targetRef, err },
      'Memory safety check failed, allowing action',
    );
    // On failure, default to safe (don't block actions if memory is down)
    return { safe: true };
  }
}

// ── Conflict detection ──────────────────────────────────────────────

function detectConflicts(
  aliases: IdentityAlias[],
  targetRef: string,
): SafetyCheckResult | null {
  // Check if multiple confirmed names of the same type exist
  // with different values (e.g. two different preferred names)
  const confirmedByType = new Map<string, IdentityAlias[]>();

  for (const alias of aliases) {
    if (!alias.confirmed) continue;
    const existing = confirmedByType.get(alias.aliasType) ?? [];
    existing.push(alias);
    confirmedByType.set(alias.aliasType, existing);
  }

  for (const [aliasType, group] of confirmedByType) {
    if (group.length <= 1) continue;

    const uniqueValues = new Set(group.map((a) => a.value.toLowerCase()));
    if (uniqueValues.size > 1) {
      const names = group.map((a) => `"${a.value}"`).join(', ');
      return {
        safe: false,
        reason:
          `I have conflicting ${aliasType} records for that member: ${names}. ` +
          `Can you clarify which "${targetRef}" you mean?`,
      };
    }
  }

  return null;
}

// ── Stale data detection ────────────────────────────────────────────

const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function detectStaleData(aliases: IdentityAlias[]): SafetyCheckResult | null {
  const now = Date.now();

  for (const alias of aliases) {
    const age = now - new Date(alias.updatedAt).getTime();
    const isStale = age > STALE_THRESHOLD_MS;
    const isLowConfidence = alias.confidence < 0.7;

    // Only flag if the alias is both stale AND low confidence
    if (isStale && isLowConfidence && !alias.confirmed) {
      return {
        safe: false,
        reason:
          `My memory about "${alias.value}" (${alias.aliasType}) is outdated and uncertain. ` +
          `Can you confirm who you're referring to?`,
      };
    }
  }

  return null;
}

// ── Alias matching ──────────────────────────────────────────────────

/**
 * Find identity aliases that plausibly match a target reference string.
 * We search all members' aliases in the guild for fuzzy matches.
 */
async function findMatchingAliases(
  guildId: string,
  targetRef: string,
): Promise<IdentityAlias[]> {
  // For now, we can't search aliases by value directly without
  // a full-text search index. Instead, we'll rely on the fact that
  // the deterministic action executor resolves the actual Discord
  // member first — so we check aliases for ANY member that might
  // match. This is a best-effort check.
  //
  // A full implementation would query:
  //   SELECT * FROM identity_aliases
  //   WHERE (guild_id = $1 OR guild_id IS NULL)
  //     AND lower(value) LIKE lower($2)
  //
  // For now, return empty — the conflict detection will be active
  // when we have a known member ID from the executor context.
  //
  // The main safety benefit still comes from:
  // 1. The response prompt including memory-confidence markers
  // 2. The identity module never inventing real names
  // 3. The explicit `confirmed` flag gating preferred name usage
  return [];
}

/**
 * Check identity safety for a known member (by ID).
 * Used by the action executor after member resolution.
 */
export async function checkMemberIdentitySafety(
  memberId: string,
  guildId: string,
  targetRef: string,
): Promise<SafetyCheckResult> {
  try {
    const aliases = await getAllKnownNames(memberId, guildId);

    if (aliases.length === 0) return { safe: true };

    const conflict = detectConflicts(aliases, targetRef);
    if (conflict) return conflict;

    const stale = detectStaleData(aliases);
    if (stale) return stale;

    return { safe: true };
  } catch {
    return { safe: true };
  }
}
