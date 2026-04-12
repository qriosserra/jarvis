import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setContainer, type Container } from '../../container.js';
import {
  stubContainer,
  stubLlmProvider,
  stubProviderRouter,
  fakeInteractionContext,
} from '../../__tests__/helpers/fixtures.js';
import { handleInteraction } from '../orchestrator.js';
import type { LlmResponse } from '../../providers/types.js';

// ── Setup ────────────────────────────────────────────────────────────

let container: Container;

beforeEach(() => {
  container = stubContainer();
  setContainer(container);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Persona resolution regression tests ──────────────────────────────

describe('persona resolution — happy path', () => {
  it('resolves persona name to DB UUID and persists interactions with the UUID', async () => {
    const PERSONA_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

    // Stub findByName to return a persona with a known UUID
    container.repos.personas.findByName = vi.fn(async () => ({
      id: PERSONA_UUID,
      name: 'jarvis',
      description: 'Default persona',
      systemPrompt: 'You are Jarvis.',
      responseStyle: {},
      isDefault: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    // interpretation → response → memory extraction
    const llm = stubLlmProvider({
      complete: vi.fn()
        .mockResolvedValueOnce({
          content: '{"kind":"respond"}',
          model: 'stub',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        } satisfies LlmResponse)
        .mockResolvedValueOnce({
          content: 'Hello there!',
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
      personaId: 'jarvis',
      sourceMessage: { reply: vi.fn(async () => ({})) } as any,
    });

    await handleInteraction(ctx);

    // Verify resolvedPersonaDbId was set on context
    expect(ctx.resolvedPersonaDbId).toBe(PERSONA_UUID);

    // Verify interactions.create was called with the UUID, not the name
    expect(container.repos.interactions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        personaId: PERSONA_UUID,
      }),
    );

    // Verify interactions.create was NOT called with the name string
    const createCall = (container.repos.interactions.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createCall.personaId).not.toBe('jarvis');
  });
});

describe('persona resolution — persona not found', () => {
  it('persists interaction with null persona_id when persona cannot be resolved', async () => {
    // Stub findByName to return null (persona not found)
    container.repos.personas.findByName = vi.fn(async () => null);

    // interpretation → response → memory extraction
    const llm = stubLlmProvider({
      complete: vi.fn()
        .mockResolvedValueOnce({
          content: '{"kind":"respond"}',
          model: 'stub',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        } satisfies LlmResponse)
        .mockResolvedValueOnce({
          content: 'Hello!',
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
      personaId: 'nonexistent',
      sourceMessage: { reply: vi.fn(async () => ({})) } as any,
    });

    await handleInteraction(ctx);

    // resolvedPersonaDbId should remain undefined
    expect(ctx.resolvedPersonaDbId).toBeUndefined();

    // interactions.create should receive null for personaId
    expect(container.repos.interactions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        personaId: null,
      }),
    );
  });
});

describe('persona resolution — persona lookup throws', () => {
  it('gracefully degrades and persists with null persona_id', async () => {
    // Stub findByName to throw
    container.repos.personas.findByName = vi.fn(async () => {
      throw new Error('DB connection failed');
    });

    // interpretation → response → memory extraction
    const llm = stubLlmProvider({
      complete: vi.fn()
        .mockResolvedValueOnce({
          content: '{"kind":"respond"}',
          model: 'stub',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        } satisfies LlmResponse)
        .mockResolvedValueOnce({
          content: 'Hello!',
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
      personaId: 'jarvis',
      sourceMessage: { reply: vi.fn(async () => ({})) } as any,
    });

    await handleInteraction(ctx);

    // Should still complete — persona resolution is non-fatal
    expect(ctx.sourceMessage!.reply).toHaveBeenCalled();

    // interactions.create should receive null for personaId
    expect(container.repos.interactions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        personaId: null,
      }),
    );
  });
});
