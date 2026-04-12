import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setContainer, type Container } from '../container.js';
import {
  stubContainer,
  stubLlmProvider,
  stubProviderRouter,
  fakeInteractionContext,
} from './helpers/fixtures.js';
import { handleInteraction } from '../interaction/orchestrator.js';
import type { LlmResponse } from '../providers/types.js';

// ── Setup ────────────────────────────────────────────────────────────

let container: Container;

beforeEach(() => {
  container = stubContainer();
  setContainer(container);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Discord failure cases ────────────────────────────────────────────

describe('discord failures — guild fetch fails', () => {
  it('propagates the error when guild cannot be fetched for an action', async () => {
    const llm = stubLlmProvider({
      complete: vi.fn().mockResolvedValueOnce({
        content: '{"kind":"join-voice","channelRef":"Gaming"}',
        model: 'stub',
      } satisfies LlmResponse),
    });

    container.discord.guilds.fetch = vi.fn(async () => {
      throw new Error('Unknown Guild');
    }) as any;
    container.providers = stubProviderRouter({ llm });
    setContainer(container);

    const ctx = fakeInteractionContext({
      requestText: 'join gaming',
      sourceMessage: { reply: vi.fn(async () => ({})) } as any,
    });

    // The executor does not catch guild.fetch errors — the error
    // propagates, and the caller (events.ts handler) is responsible
    // for catching it. Verify it surfaces as expected.
    await expect(handleInteraction(ctx)).rejects.toThrow('Unknown Guild');
  });
});

describe('discord failures — message reply fails, falls back to channel send', () => {
  it('falls back to channel.send when sourceMessage.reply throws', async () => {
    const llm = stubLlmProvider({
      complete: vi.fn()
        .mockResolvedValueOnce({
          content: '{"kind":"respond"}',
          model: 'stub',
        } satisfies LlmResponse)
        .mockResolvedValueOnce({
          content: 'Hello!',
          model: 'stub',
        } satisfies LlmResponse),
    });

    const channelSend = vi.fn(async () => ({}));
    container.discord.channels.fetch = vi.fn(async () => ({
      id: 'ch-1',
      send: channelSend,
    })) as any;
    container.providers = stubProviderRouter({ llm });
    setContainer(container);

    const ctx = fakeInteractionContext({
      sourceMessage: {
        reply: vi.fn(async () => { throw new Error('Cannot reply'); }),
      } as any,
    });

    await handleInteraction(ctx);

    // Should fall back to channel send
    expect(channelSend).toHaveBeenCalledWith('Hello!');
  });
});

describe('discord failures — LLM provider throws during interpretation', () => {
  it('falls back to respond intent and still delivers a reply', async () => {
    const llm = stubLlmProvider({
      complete: vi.fn()
        // First call (interpretation) throws
        .mockRejectedValueOnce(new Error('LLM timeout'))
        // Second call (response generation for fallback respond) succeeds
        .mockResolvedValueOnce({
          content: 'Sorry, I had trouble understanding. How can I help?',
          model: 'stub',
        } satisfies LlmResponse),
    });

    container.providers = stubProviderRouter({ llm });
    setContainer(container);

    const ctx = fakeInteractionContext({
      sourceMessage: { reply: vi.fn(async () => ({})) } as any,
    });

    await handleInteraction(ctx);

    expect(ctx.sourceMessage!.reply).toHaveBeenCalledWith(
      expect.stringContaining('Sorry'),
    );
  });
});

describe('discord failures — action handler permission denied', () => {
  it('returns user-facing permission error for rename without ManageNicknames', async () => {
    const llm = stubLlmProvider({
      complete: vi.fn().mockResolvedValueOnce({
        content: '{"kind":"rename-member","targetRef":"alice","newName":"Ally"}',
        model: 'stub',
      } satisfies LlmResponse),
    });

    const targetMember = {
      id: 'u2',
      displayName: 'Alice',
      user: { id: 'u2', username: 'alice' },
      voice: { channel: null },
      roles: { highest: { position: 5 } },
      setNickname: vi.fn(),
    };

    const botMember = {
      id: 'bot-user-id',
      permissions: { has: () => false }, // No ManageNicknames
      roles: { highest: { position: 100 } },
    };

    const guild = {
      id: 'g1',
      ownerId: 'owner-id',
      members: {
        fetch: vi.fn(async (userId?: string) => {
          if (userId === 'u2') return targetMember;
          if (!userId) return new Map();
          throw new Error('not found');
        }),
        fetchMe: vi.fn(async () => botMember),
        cache: {
          filter: vi.fn(() => ({
            size: 1,
            first: () => targetMember,
            values: () => [targetMember],
          })),
        },
      },
      channels: { cache: { get: vi.fn(), find: vi.fn(), filter: vi.fn() } },
    };

    container.discord.guilds.fetch = vi.fn(async () => guild) as any;
    container.providers = stubProviderRouter({ llm });
    setContainer(container);

    const ctx = fakeInteractionContext({
      requestText: 'rename alice to Ally',
      sourceMessage: { reply: vi.fn(async () => ({})) } as any,
    });

    await handleInteraction(ctx);

    expect(ctx.sourceMessage!.reply).toHaveBeenCalledWith(
      expect.stringContaining('Manage Nicknames'),
    );
    // Rename should NOT have been attempted
    expect(targetMember.setNickname).not.toHaveBeenCalled();
  });
});

describe('discord failures — rename blocked for server owner', () => {
  it('returns user-facing error when target is server owner', async () => {
    const llm = stubLlmProvider({
      complete: vi.fn().mockResolvedValueOnce({
        content: '{"kind":"rename-member","targetRef":"owner","newName":"Boss"}',
        model: 'stub',
      } satisfies LlmResponse),
    });

    const ownerMember = {
      id: 'owner-id',
      displayName: 'Owner',
      user: { id: 'owner-id', username: 'owner' },
      voice: { channel: null },
      roles: { highest: { position: 50 } },
      setNickname: vi.fn(),
    };

    const botMember = {
      id: 'bot-user-id',
      permissions: { has: () => true },
      roles: { highest: { position: 100 } },
    };

    const guild = {
      id: 'g1',
      ownerId: 'owner-id',
      members: {
        fetch: vi.fn(async (userId?: string) => {
          if (userId === 'owner-id') return ownerMember;
          if (!userId) return new Map();
          throw new Error('not found');
        }),
        fetchMe: vi.fn(async () => botMember),
        cache: {
          filter: vi.fn(() => ({
            size: 1,
            first: () => ownerMember,
            values: () => [ownerMember],
          })),
        },
      },
      channels: { cache: { get: vi.fn(), find: vi.fn(), filter: vi.fn() } },
    };

    container.discord.guilds.fetch = vi.fn(async () => guild) as any;
    container.providers = stubProviderRouter({ llm });
    setContainer(container);

    const ctx = fakeInteractionContext({
      requestText: 'rename owner to Boss',
      sourceMessage: { reply: vi.fn(async () => ({})) } as any,
    });

    await handleInteraction(ctx);

    expect(ctx.sourceMessage!.reply).toHaveBeenCalledWith(
      expect.stringContaining("server owner"),
    );
    expect(ownerMember.setNickname).not.toHaveBeenCalled();
  });
});

describe('discord failures — memory persistence failure does not break flow', () => {
  it('completes the interaction even when memory persistence throws', async () => {
    const llm = stubLlmProvider({
      complete: vi.fn()
        .mockResolvedValueOnce({
          content: '{"kind":"respond"}',
          model: 'stub',
        } satisfies LlmResponse)
        .mockResolvedValueOnce({
          content: 'All good!',
          model: 'stub',
        } satisfies LlmResponse),
    });

    container.repos.interactions.create = vi.fn(async () => {
      throw new Error('Database down');
    }) as any;
    container.providers = stubProviderRouter({ llm });
    setContainer(container);

    const ctx = fakeInteractionContext({
      sourceMessage: { reply: vi.fn(async () => ({})) } as any,
    });

    // Should not throw
    await handleInteraction(ctx);
    expect(ctx.sourceMessage!.reply).toHaveBeenCalledWith('All good!');
  });
});
