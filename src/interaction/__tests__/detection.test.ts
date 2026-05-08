import { describe, it, expect, vi } from 'vitest';
import {
  detectTextRequest,
  detectIndirectRequest,
  extractRequestText,
} from '../detection.js';
import type { Message, Collection, User } from 'discord.js';
import type { LlmProvider, LlmResponse } from '../../providers/types.js';

// ── Helpers ──────────────────────────────────────────────────────────

const BOT_ID = '100000000000000000';

function fakeMessage(overrides: {
  content?: string;
  mentionedUsers?: Map<string, unknown>;
  repliedUserId?: string | null;
  id?: string;
}): Message {
  const mentionedUsers = new Map(overrides.mentionedUsers ?? []);
  return {
    id: overrides.id ?? '200000000000000000',
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

function fakeLlmProvider(
  complete: LlmProvider['complete'],
  name = 'fake',
): LlmProvider {
  return { name, complete };
}

function llmResponse(content: string, model = 'fake-model'): LlmResponse {
  return { content, model };
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

describe('detectIndirectRequest', () => {
  it('returns indirect trigger when classifier replies YES', async () => {
    const complete: LlmProvider['complete'] = vi.fn(async () => llmResponse('YES'));
    const provider = fakeLlmProvider(complete);
    const msg = fakeMessage({ content: 'can someone explain JWTs?' });

    const result = await detectIndirectRequest(msg, provider, 'grok-3-mini');

    expect(result).toEqual({ isForJarvis: true, trigger: 'indirect' });
    expect(complete).toHaveBeenCalledTimes(1);
    const call = vi.mocked(complete).mock.calls[0]!;
    const [messages, opts] = call;
    expect(messages[0]).toEqual({
      role: 'system',
      content: 'You are a classifier. Reply with exactly YES or NO.',
    });
    expect(messages[1]!.role).toBe('user');
    expect(messages[1]!.content).toContain('can someone explain JWTs?');
    expect(opts).toMatchObject({ temperature: 0, maxTokens: 5 });
  });

  it('returns false when classifier replies NO', async () => {
    const provider = fakeLlmProvider(async () => llmResponse('NO'));
    const msg = fakeMessage({ content: 'lol that was hilarious' });

    const result = await detectIndirectRequest(msg, provider, 'grok-3-mini');

    expect(result).toEqual({ isForJarvis: false });
  });

  it('fails safe (isForJarvis: false) when the provider throws', async () => {
    const provider = fakeLlmProvider(async () => {
      throw new Error('network down');
    });
    const msg = fakeMessage({ content: 'hey what is the weather today?' });

    const result = await detectIndirectRequest(msg, provider, 'grok-3-mini');

    expect(result).toEqual({ isForJarvis: false });
  });

  it('passes through the override model when provided', async () => {
    const complete: LlmProvider['complete'] = vi.fn(async () => llmResponse('YES'));
    const provider = fakeLlmProvider(complete);
    const msg = fakeMessage({ content: 'need help with regex' });

    await detectIndirectRequest(msg, provider, 'grok-classifier');

    const call = vi.mocked(complete).mock.calls[0]!;
    expect(call[1]).toMatchObject({ model: 'grok-classifier' });
  });

  it('returns false without calling the provider for empty content', async () => {
    const complete: LlmProvider['complete'] = vi.fn(async () => llmResponse('YES'));
    const provider = fakeLlmProvider(complete);
    const msg = fakeMessage({ content: '   ' });

    const result = await detectIndirectRequest(msg, provider, 'grok-3-mini');

    expect(result).toEqual({ isForJarvis: false });
    expect(complete).not.toHaveBeenCalled();
  });
});
