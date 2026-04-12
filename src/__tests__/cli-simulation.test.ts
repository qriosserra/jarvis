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

// ── replyHandler delivery ────────────────────────────────────────────

describe('CLI simulation — replyHandler delivery', () => {
  it('delivers conversational response via replyHandler instead of Discord', async () => {
    const llm = stubLlmProvider({
      complete: vi.fn()
        .mockResolvedValueOnce({
          content: '{"kind":"respond"}',
          model: 'stub',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        } satisfies LlmResponse)
        .mockResolvedValueOnce({
          content: 'The current time is 3 PM.',
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

    const replies: string[] = [];
    const ctx = fakeInteractionContext({
      requestText: 'What time is it?',
      replyHandler: (text: string) => { replies.push(text); },
    });

    await handleInteraction(ctx);

    expect(replies).toHaveLength(1);
    expect(replies[0]).toBe('The current time is 3 PM.');
  });

  it('delivers ask-clarification via replyHandler', async () => {
    const llm = stubLlmProvider({
      complete: vi.fn()
        .mockResolvedValueOnce({
          content: '{"kind":"ask-clarification","question":"Which channel?"}',
          model: 'stub',
        } satisfies LlmResponse)
        .mockResolvedValueOnce({
          content: '[]',
          model: 'stub',
        } satisfies LlmResponse),
    });

    container.providers = stubProviderRouter({ llm });
    setContainer(container);

    const replies: string[] = [];
    const ctx = fakeInteractionContext({
      requestText: 'join voice',
      replyHandler: (text: string) => { replies.push(text); },
    });

    await handleInteraction(ctx);

    expect(replies).toHaveLength(1);
    expect(replies[0]).toBe('Which channel?');
  });
});

// ── simulateActions ──────────────────────────────────────────────────

describe('CLI simulation — deterministic action simulation', () => {
  it('simulates rename-member without calling Discord APIs', async () => {
    const llm = stubLlmProvider({
      complete: vi.fn().mockResolvedValueOnce({
        content: '{"kind":"rename-member","targetRef":"alice","newName":"Ally"}',
        model: 'stub',
      } satisfies LlmResponse),
    });

    container.providers = stubProviderRouter({ llm });
    setContainer(container);

    const replies: string[] = [];
    const ctx = fakeInteractionContext({
      requestText: 'rename alice to Ally',
      simulateActions: true,
      replyHandler: (text: string) => { replies.push(text); },
    });

    await handleInteraction(ctx);

    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain('[simulated]');
    expect(replies[0]).toContain('rename');
    expect(replies[0]).toContain('alice');
    expect(replies[0]).toContain('Ally');
  });

  it('simulates join-voice without calling Discord APIs', async () => {
    const llm = stubLlmProvider({
      complete: vi.fn().mockResolvedValueOnce({
        content: '{"kind":"join-voice","channelRef":"General"}',
        model: 'stub',
      } satisfies LlmResponse),
    });

    container.providers = stubProviderRouter({ llm });
    setContainer(container);

    const replies: string[] = [];
    const ctx = fakeInteractionContext({
      requestText: 'join general voice channel',
      simulateActions: true,
      replyHandler: (text: string) => { replies.push(text); },
    });

    await handleInteraction(ctx);

    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain('[simulated]');
    expect(replies[0]).toContain('General');
  });

  it('simulates mute-member', async () => {
    const llm = stubLlmProvider({
      complete: vi.fn().mockResolvedValueOnce({
        content: '{"kind":"mute-member","targetRef":"bob","mute":true}',
        model: 'stub',
      } satisfies LlmResponse),
    });

    container.providers = stubProviderRouter({ llm });
    setContainer(container);

    const replies: string[] = [];
    const ctx = fakeInteractionContext({
      requestText: 'mute bob',
      simulateActions: true,
      replyHandler: (text: string) => { replies.push(text); },
    });

    await handleInteraction(ctx);

    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain('[simulated]');
    expect(replies[0]).toContain('mute');
    expect(replies[0]).toContain('bob');
  });

  it('simulates send-text-message', async () => {
    const llm = stubLlmProvider({
      complete: vi.fn().mockResolvedValueOnce({
        content: '{"kind":"send-text-message","channelRef":"general","message":"Hello world"}',
        model: 'stub',
      } satisfies LlmResponse),
    });

    container.providers = stubProviderRouter({ llm });
    setContainer(container);

    const replies: string[] = [];
    const ctx = fakeInteractionContext({
      requestText: 'send hello world to general',
      simulateActions: true,
      replyHandler: (text: string) => { replies.push(text); },
    });

    await handleInteraction(ctx);

    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain('[simulated]');
    expect(replies[0]).toContain('Hello world');
  });

  it('simulates move-member', async () => {
    const llm = stubLlmProvider({
      complete: vi.fn().mockResolvedValueOnce({
        content: '{"kind":"move-member","targetRef":"alice","destinationRef":"Lobby"}',
        model: 'stub',
      } satisfies LlmResponse),
    });

    container.providers = stubProviderRouter({ llm });
    setContainer(container);

    const replies: string[] = [];
    const ctx = fakeInteractionContext({
      requestText: 'move alice to lobby',
      simulateActions: true,
      replyHandler: (text: string) => { replies.push(text); },
    });

    await handleInteraction(ctx);

    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain('[simulated]');
    expect(replies[0]).toContain('alice');
    expect(replies[0]).toContain('Lobby');
  });

  it('simulates deafen-member', async () => {
    const llm = stubLlmProvider({
      complete: vi.fn().mockResolvedValueOnce({
        content: '{"kind":"deafen-member","targetRef":"charlie","deafen":true}',
        model: 'stub',
      } satisfies LlmResponse),
    });

    container.providers = stubProviderRouter({ llm });
    setContainer(container);

    const replies: string[] = [];
    const ctx = fakeInteractionContext({
      requestText: 'deafen charlie',
      simulateActions: true,
      replyHandler: (text: string) => { replies.push(text); },
    });

    await handleInteraction(ctx);

    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain('[simulated]');
    expect(replies[0]).toContain('deafen');
    expect(replies[0]).toContain('charlie');
  });
});

// ── Headless container (no Discord client) ───────────────────────────

describe('CLI simulation — headless container', () => {
  it('works without discord client in the container when using replyHandler + simulateActions', async () => {
    // Create a container without the Discord client
    const headlessContainer = stubContainer({ discord: undefined });

    const llm = stubLlmProvider({
      complete: vi.fn()
        .mockResolvedValueOnce({
          content: '{"kind":"respond"}',
          model: 'stub',
        } satisfies LlmResponse)
        .mockResolvedValueOnce({
          content: 'Hello from headless mode!',
          model: 'stub',
        } satisfies LlmResponse)
        .mockResolvedValueOnce({
          content: '[]',
          model: 'stub',
        } satisfies LlmResponse),
    });

    headlessContainer.providers = stubProviderRouter({ llm });
    setContainer(headlessContainer);

    const replies: string[] = [];
    const ctx = fakeInteractionContext({
      requestText: 'hello',
      replyHandler: (text: string) => { replies.push(text); },
    });

    await handleInteraction(ctx);

    expect(replies).toHaveLength(1);
    expect(replies[0]).toBe('Hello from headless mode!');
  });

  it('simulates deterministic actions without discord client', async () => {
    const headlessContainer = stubContainer({ discord: undefined });

    const llm = stubLlmProvider({
      complete: vi.fn().mockResolvedValueOnce({
        content: '{"kind":"rename-member","targetRef":"dave","newName":"David"}',
        model: 'stub',
      } satisfies LlmResponse),
    });

    headlessContainer.providers = stubProviderRouter({ llm });
    setContainer(headlessContainer);

    const replies: string[] = [];
    const ctx = fakeInteractionContext({
      requestText: 'rename dave to David',
      simulateActions: true,
      replyHandler: (text: string) => { replies.push(text); },
    });

    await handleInteraction(ctx);

    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain('[simulated]');
    expect(replies[0]).toContain('David');
  });
});
