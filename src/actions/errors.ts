import type { ResolveResult, ActionResult } from './types.js';

/**
 * Convert a non-found resolution result into a user-facing ActionResult.
 * Handles both ambiguous and not-found states with clarification prompts.
 */
export function formatResolveError<T extends { name?: string; displayName?: string; user?: { username: string } }>(
  entityType: string,
  result: Exclude<ResolveResult<T>, { status: 'found' }>,
): ActionResult {
  if (result.status === 'ambiguous') {
    const names = result.matches
      .slice(0, 5)
      .map((m) => `• **${getName(m)}**`)
      .join('\n');
    const suffix = result.matches.length > 5
      ? `\n…and ${result.matches.length - 5} more`
      : '';
    return {
      success: false,
      message:
        `I found multiple ${entityType}s matching "${result.label}". Which one did you mean?\n${names}${suffix}`,
    };
  }

  return {
    success: false,
    message: `I couldn't find a ${entityType} called "${result.label}".`,
  };
}

/**
 * Map a caught Discord API error to a user-facing explanation.
 */
export function formatDiscordApiError(err: unknown, action: string): string {
  const msg = err instanceof Error ? err.message : String(err);

  // Common Discord error codes
  if (msg.includes('Missing Permissions') || msg.includes('50013')) {
    return `I don't have the required permissions to ${action}.`;
  }
  if (msg.includes('Missing Access') || msg.includes('50001')) {
    return `I don't have access to perform that action.`;
  }
  if (msg.includes('Unknown Member') || msg.includes('10007')) {
    return `The target member could not be found in this server.`;
  }
  if (msg.includes('Unknown Channel') || msg.includes('10003')) {
    return `The target channel could not be found.`;
  }

  return `Failed to ${action}: ${msg}`;
}

// ── Helpers ─────────────────────────────────────────────────────────

function getName(entity: { name?: string; displayName?: string; user?: { username: string } }): string {
  if ('displayName' in entity && entity.displayName) return entity.displayName;
  if ('user' in entity && entity.user) return entity.user.username;
  if ('name' in entity && entity.name) return entity.name;
  return 'unknown';
}
