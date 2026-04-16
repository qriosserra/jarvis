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

// ── Text flow integration tests ──────────────────────────────────────

describe('text flow — conversational respond', () => {
  it('routes a mention-triggered text request through interpretation → response → delivery', async () => {
    // Interpretation LLM returns "respond"
    // 3 calls: interpretation → response generation → memory extraction
    const llm = stubLlmProvider({
      complete: vi.fn()
        .mockResolvedValueOnce({
          content: '{"kind":"respond"}',
          model: 'stub',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        } satisfies LlmResponse)
        .mockResolvedValueOnce({
          content: 'It is 3 PM.',
          model: 'stub',
          usage: { promptTokens: 20, completionTokens: 8, totalTokens: 28 },
        } satisfies LlmResponse)
        .mockResolvedValueOnce({
          content: '[]',
          model: 'stub',
        } satisfies LlmResponse),
    });

    container.providers = stubProviderRouter({ llm });
    setContainer(container);

    const ctx = fakeInteractionContext({
      requestText: 'What time is it?',
      sourceMessage: {
        reply: vi.fn(async () => ({})),
      } as any,
    });

    await handleInteraction(ctx);

    // interpretation + response + memory extraction
    expect(llm.complete).toHaveBeenCalledTimes(3);

    // First call is interpretation
    const interpCall = (llm.complete as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(interpCall[0][0].content).toContain('intent classifier');

    // Second call is response generation
    const respCall = (llm.complete as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(respCall[0].some((m: any) => m.content === 'What time is it?')).toBe(true);

    // Reply was delivered
    expect(ctx.sourceMessage!.reply).toHaveBeenCalledWith('It is 3 PM.');
  });
});

describe('text flow — ask-clarification', () => {
  it('forwards the clarification question directly without a second LLM call', async () => {
    // 2 calls: interpretation → memory extraction (clarification is returned directly)
    const llm = stubLlmProvider({
      complete: vi.fn()
        .mockResolvedValueOnce({
          content: '{"kind":"ask-clarification","question":"Which Bob do you mean?"}',
          model: 'stub',
        } satisfies LlmResponse)
        .mockResolvedValueOnce({
          content: '[]',
          model: 'stub',
        } satisfies LlmResponse),
    });

    container.providers = stubProviderRouter({ llm });
    setContainer(container);

    const ctx = fakeInteractionContext({
      requestText: 'Rename bob',
      sourceMessage: { reply: vi.fn(async () => ({})) } as any,
    });

    await handleInteraction(ctx);

    // interpretation + memory extraction (no response generation call)
    expect(llm.complete).toHaveBeenCalledTimes(2);
    expect(ctx.sourceMessage!.reply).toHaveBeenCalledWith('Which Bob do you mean?');
  });
});

describe('text flow — research-and-respond', () => {
  it('calls research provider then synthesises a response', async () => {
    const llm = stubLlmProvider({
      complete: vi.fn()
        .mockResolvedValueOnce({
          content: '{"kind":"research-and-respond","query":"node.js 22 release date"}',
          model: 'stub',
        } satisfies LlmResponse)
        .mockResolvedValueOnce({
          content: 'Node.js 22 was released on April 24, 2024.',
          model: 'stub',
        } satisfies LlmResponse),
    });

    const research = {
      name: 'stub-research',
      search: vi.fn(async () => [
        { title: 'Node 22', url: 'https://nodejs.org', snippet: 'Released April 2024' },
      ]),
      getPageContent: vi.fn(async () => ''),
    };

    container.providers = stubProviderRouter({ llm, research });
    setContainer(container);

    const ctx = fakeInteractionContext({
      requestText: 'When was Node 22 released?',
      sourceMessage: { reply: vi.fn(async () => ({})) } as any,
    });

    await handleInteraction(ctx);

    expect(research.search).toHaveBeenCalledWith('node.js 22 release date', { maxResults: 5 });
    expect(ctx.sourceMessage!.reply).toHaveBeenCalledWith(
      expect.stringContaining('Node.js 22'),
    );
  });
});

describe('text flow — deterministic action (rename)', () => {
  it('interprets rename intent and dispatches to deterministic handler', async () => {
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
      permissions: { has: () => true },
      setNickname: vi.fn(async () => {}),
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
        fetchMe: vi.fn(async () => ({
          id: 'bot-user-id',
          permissions: { has: () => true },
          roles: { highest: { position: 100 } },
        })),
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

    container.discord!.guilds.fetch = vi.fn(async () => guild) as any;
    container.providers = stubProviderRouter({ llm });
    setContainer(container);

    const ctx = fakeInteractionContext({
      requestText: 'rename alice to Ally',
      sourceMessage: { reply: vi.fn(async () => ({})) } as any,
    });

    await handleInteraction(ctx);

    // Rename was attempted
    expect(targetMember.setNickname).toHaveBeenCalledWith('Ally');
    // Result was sent back
    expect(ctx.sourceMessage!.reply).toHaveBeenCalledWith(
      expect.stringContaining('Ally'),
    );
  });
});

describe('text flow — deterministic action persistence', () => {
  it('creates an interaction row and uses its UUID for actionOutcomes.create', async () => {
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
      permissions: { has: () => true },
      setNickname: vi.fn(async () => {}),
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
        fetchMe: vi.fn(async () => ({
          id: 'bot-user-id',
          permissions: { has: () => true },
          roles: { highest: { position: 100 } },
        })),
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

    container.discord!.guilds.fetch = vi.fn(async () => guild) as any;
    container.providers = stubProviderRouter({ llm });
    setContainer(container);

    const ctx = fakeInteractionContext({
      requestText: 'rename alice to Ally',
      sourceMessage: { reply: vi.fn(async () => ({})) } as any,
    });

    await handleInteraction(ctx);

    // interactions.create called once by the orchestrator's early creation (not the executor)
    expect(container.repos.interactions.create).toHaveBeenCalledTimes(1);

    // Early-created interaction row is reused: executor backfills response and links outcome
    expect(container.repos.interactions.update).toHaveBeenCalledWith('int-1', expect.objectContaining({ responseText: expect.any(String) }));

    // actionOutcomes.create must receive the UUID returned by interactions.create, not ctx.correlationId
    const aoCall = (container.repos.actionOutcomes.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(aoCall.interactionId).toBe('int-1'); // stub returns { id: 'int-1' }
    expect(aoCall.interactionId).not.toBe(ctx.correlationId);
  });

  it('still delivers the reply when interaction persistence throws', async () => {
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
      permissions: { has: () => true },
      setNickname: vi.fn(async () => {}),
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
        fetchMe: vi.fn(async () => ({
          id: 'bot-user-id',
          permissions: { has: () => true },
          roles: { highest: { position: 100 } },
        })),
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

    // Make interaction persistence throw
    container.repos.interactions.create = vi.fn(async () => {
      throw new Error('DB connection lost');
    }) as any;

    container.discord!.guilds.fetch = vi.fn(async () => guild) as any;
    container.providers = stubProviderRouter({ llm });
    setContainer(container);

    const ctx = fakeInteractionContext({
      requestText: 'rename alice to Ally',
      sourceMessage: { reply: vi.fn(async () => ({})) } as any,
    });

    await handleInteraction(ctx);

    // Reply should still be delivered despite persistence failure
    expect(ctx.sourceMessage!.reply).toHaveBeenCalledWith(
      expect.stringContaining('Ally'),
    );
  });
});

describe('text flow — early interaction lifecycle', () => {
  it('sets ctx.interactionId after early interaction creation', async () => {
    const llm = stubLlmProvider({
      complete: vi.fn()
        .mockResolvedValueOnce({ content: '{"kind":"respond"}', model: 'stub' } satisfies LlmResponse)
        .mockResolvedValueOnce({ content: 'Hello!', model: 'stub' } satisfies LlmResponse)
        .mockResolvedValueOnce({ content: '[]', model: 'stub' } satisfies LlmResponse),
    });

    container.providers = stubProviderRouter({ llm });
    setContainer(container);

    const ctx = fakeInteractionContext({
      sourceMessage: { reply: vi.fn(async () => ({})) } as any,
    });

    expect(ctx.interactionId).toBeUndefined();
    await handleInteraction(ctx);
    expect(ctx.interactionId).toBe('int-1');
  });

  it('creates the interaction row once for conversational flow and backfills response', async () => {
    const llm = stubLlmProvider({
      complete: vi.fn()
        .mockResolvedValueOnce({ content: '{"kind":"respond"}', model: 'stub' } satisfies LlmResponse)
        .mockResolvedValueOnce({ content: 'World', model: 'stub' } satisfies LlmResponse)
        .mockResolvedValueOnce({ content: '[]', model: 'stub' } satisfies LlmResponse),
    });

    container.providers = stubProviderRouter({ llm });
    setContainer(container);

    const ctx = fakeInteractionContext({
      sourceMessage: { reply: vi.fn(async () => ({})) } as any,
    });

    await handleInteraction(ctx);

    // Only one interaction row created (early, by orchestrator)
    expect(container.repos.interactions.create).toHaveBeenCalledTimes(1);

    // Response text backfilled via update
    expect(container.repos.interactions.update).toHaveBeenCalledWith('int-1', { responseText: 'World' });
  });

  it('proceeds without interactionId when early creation fails', async () => {
    container.repos.interactions.create = vi.fn(async () => {
      throw new Error('DB down');
    }) as any;

    const llm = stubLlmProvider({
      complete: vi.fn()
        .mockResolvedValueOnce({ content: '{"kind":"respond"}', model: 'stub' } satisfies LlmResponse)
        .mockResolvedValueOnce({ content: 'Still works!', model: 'stub' } satisfies LlmResponse),
    });

    container.providers = stubProviderRouter({ llm });
    setContainer(container);

    const ctx = fakeInteractionContext({
      sourceMessage: { reply: vi.fn(async () => ({})) } as any,
    });

    await handleInteraction(ctx);

    // interactionId remains unset when creation fails
    expect(ctx.interactionId).toBeUndefined();
    // Reply still delivered
    expect(ctx.sourceMessage!.reply).toHaveBeenCalledWith('Still works!');
  });
});

describe('text flow — interpretation failure fallback', () => {
  it('falls back to respond intent when LLM returns invalid JSON', async () => {
    const llm = stubLlmProvider({
      complete: vi.fn()
        .mockResolvedValueOnce({
          content: 'this is not valid json at all',
          model: 'stub',
        } satisfies LlmResponse)
        .mockResolvedValueOnce({
          content: 'I can help with that!',
          model: 'stub',
        } satisfies LlmResponse),
    });

    container.providers = stubProviderRouter({ llm });
    setContainer(container);

    const ctx = fakeInteractionContext({
      sourceMessage: { reply: vi.fn(async () => ({})) } as any,
    });

    await handleInteraction(ctx);

    // Should still produce a response despite bad interpretation
    expect(ctx.sourceMessage!.reply).toHaveBeenCalledWith('I can help with that!');
  });
});
