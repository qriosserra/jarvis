import { describe, it, expect } from 'vitest';
import { detectTextRequest, extractRequestText } from '../detection.js';
import type { Message, Collection, User } from 'discord.js';

// ── Helpers ──────────────────────────────────────────────────────────

const BOT_ID = '100000000000000000';

function fakeMessage(overrides: {
  content?: string;
  mentionedUsers?: Map<string, unknown>;
  repliedUserId?: string | null;
}): Message {
  const mentionedUsers = new Map(overrides.mentionedUsers ?? []);
  return {
    content: overrides.content ?? '',
    mentions: {
      users: {
        has: (id: string) => mentionedUsers.has(id),
      } as unknown as Collection<string, User>,
      repliedUser: overrides.repliedUserId
        ? ({ id: overrides.repliedUserId } as User)
        : null,
    },
  } as unknown as Message;
}

// ── Tests ────────────────────────────────────────────────────────────

describe('detectTextRequest', () => {
  it('detects direct @mention of the bot', () => {
    const msg = fakeMessage({
      content: `<@${BOT_ID}> hello`,
      mentionedUsers: new Map([[BOT_ID, {}]]),
    });
    const result = detectTextRequest(msg, BOT_ID);
    expect(result).toEqual({ isForJarvis: true, trigger: 'mention' });
  });

  it('detects reply to the bot', () => {
    const msg = fakeMessage({
      content: 'sure thing',
      repliedUserId: BOT_ID,
    });
    const result = detectTextRequest(msg, BOT_ID);
    expect(result).toEqual({ isForJarvis: true, trigger: 'reply' });
  });

  it('returns false for unrelated messages', () => {
    const msg = fakeMessage({ content: 'hello everyone' });
    const result = detectTextRequest(msg, BOT_ID);
    expect(result).toEqual({ isForJarvis: false });
  });

  it('returns mention trigger over reply when both present', () => {
    const msg = fakeMessage({
      content: `<@${BOT_ID}> ping`,
      mentionedUsers: new Map([[BOT_ID, {}]]),
      repliedUserId: BOT_ID,
    });
    const result = detectTextRequest(msg, BOT_ID);
    expect(result).toEqual({ isForJarvis: true, trigger: 'mention' });
  });
});

describe('extractRequestText', () => {
  it('strips the bot mention and trims whitespace', () => {
    const msg = fakeMessage({ content: `<@${BOT_ID}>  what time is it?` });
    expect(extractRequestText(msg, BOT_ID)).toBe('what time is it?');
  });

  it('strips nickname-style mention (<@!id>)', () => {
    const msg = fakeMessage({ content: `<@!${BOT_ID}> hey` });
    expect(extractRequestText(msg, BOT_ID)).toBe('hey');
  });

  it('returns full content when no mention is present', () => {
    const msg = fakeMessage({ content: 'reply text here' });
    expect(extractRequestText(msg, BOT_ID)).toBe('reply text here');
  });

  it('returns empty string when content is only the mention', () => {
    const msg = fakeMessage({ content: `<@${BOT_ID}>` });
    expect(extractRequestText(msg, BOT_ID)).toBe('');
  });
});
