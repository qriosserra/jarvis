import { describe, it, expect } from 'vitest';
import { formatResolveError, formatDiscordApiError } from '../errors.js';

describe('formatResolveError', () => {
  it('returns not-found message', () => {
    const result = formatResolveError('member', {
      status: 'not-found',
      label: 'Alice',
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain('Alice');
    expect(result.message).toContain("couldn't find");
  });

  it('returns ambiguous message with candidate names', () => {
    const result = formatResolveError('voice channel', {
      status: 'ambiguous',
      label: 'gaming',
      matches: [
        { name: 'Gaming 1' },
        { name: 'Gaming 2' },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain('Gaming 1');
    expect(result.message).toContain('Gaming 2');
    expect(result.message).toContain('gaming');
  });

  it('truncates to 5 matches with overflow indicator', () => {
    const matches = Array.from({ length: 7 }, (_, i) => ({ name: `Ch${i}` }));
    const result = formatResolveError('text channel', {
      status: 'ambiguous',
      label: 'ch',
      matches,
    });
    expect(result.message).toContain('Ch4');
    expect(result.message).not.toContain('Ch5');
    expect(result.message).toContain('2 more');
  });

  it('formats member display names from displayName property', () => {
    const result = formatResolveError('member', {
      status: 'ambiguous',
      label: 'bob',
      matches: [
        { displayName: 'Bob A', user: { username: 'boba' } },
        { displayName: 'Bob B', user: { username: 'bobb' } },
      ],
    });
    expect(result.message).toContain('Bob A');
    expect(result.message).toContain('Bob B');
  });
});

describe('formatDiscordApiError', () => {
  it('maps Missing Permissions to user-friendly message', () => {
    const msg = formatDiscordApiError(new Error('Missing Permissions'), 'rename a member');
    expect(msg).toContain("don't have the required permissions");
  });

  it('maps Missing Access error code', () => {
    const msg = formatDiscordApiError(new Error('50001'), 'join');
    expect(msg).toContain("don't have access");
  });

  it('maps Unknown Member error', () => {
    const msg = formatDiscordApiError(new Error('Unknown Member'), 'move');
    expect(msg).toContain('could not be found');
  });

  it('maps Unknown Channel error', () => {
    const msg = formatDiscordApiError(new Error('10003'), 'send');
    expect(msg).toContain('channel could not be found');
  });

  it('falls back to raw message for unknown errors', () => {
    const msg = formatDiscordApiError(new Error('Timeout exceeded'), 'deafen');
    expect(msg).toContain('Timeout exceeded');
    expect(msg).toContain('deafen');
  });

  it('handles non-Error objects', () => {
    const msg = formatDiscordApiError('string error', 'mute');
    expect(msg).toContain('string error');
  });
});
