import { describe, it, expect } from 'vitest';
import { ProviderRouter, type ProviderRoute, type ProviderRegistry } from '../router.js';
import type { LlmProvider, SttProvider, TtsProvider, ResearchProvider, EmbeddingProvider } from '../types.js';

// ── Stubs ────────────────────────────────────────────────────────────

const stubLlm: LlmProvider = {
  name: 'test-llm',
  complete: async () => ({ content: '', model: 'test', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }),
};

const stubStt: SttProvider = {
  name: 'test-stt',
  createStream: () => ({
    write: () => {},
    end: () => {},
    onTranscript: () => {},
    onError: () => {},
    onClose: () => {},
  }),
};

const stubTts: TtsProvider = {
  name: 'test-tts',
  synthesize: async () => ({ audio: Buffer.alloc(0), format: 'pcm_16000', sampleRate: 16000 }),
};

const stubResearch: ResearchProvider = {
  name: 'test-research',
  search: async () => [],
  getPageContent: async () => '',
};

const stubEmbedding: EmbeddingProvider = {
  name: 'test-embedding',
  embed: async () => ({ embedding: [0], model: 'test' }),
  embedBatch: async () => [],
};

function buildRegistry(): ProviderRegistry {
  return {
    llm: new Map([['test-llm', stubLlm]]),
    stt: new Map([['test-stt', stubStt]]),
    tts: new Map([['test-tts', stubTts]]),
    research: new Map([['test-research', stubResearch]]),
    embedding: new Map([['test-embedding', stubEmbedding]]),
  };
}

function buildRoutes(): ProviderRoute[] {
  return [
    { task: 'interpretation', providerName: 'test-llm', model: 'gpt-4o-mini' },
    { task: 'response', providerName: 'test-llm', model: 'gpt-4o' },
    { task: 'transcription', providerName: 'test-stt' },
    { task: 'synthesis', providerName: 'test-tts' },
    { task: 'embedding', providerName: 'test-embedding', model: 'embed-v1' },
    { task: 'research', providerName: 'test-research' },
  ];
}

// ── Tests ────────────────────────────────────────────────────────────

describe('ProviderRouter', () => {
  it('resolves LLM providers for interpretation and response tasks', () => {
    const router = new ProviderRouter(buildRegistry(), buildRoutes());
    const interp = router.getLlm('interpretation');
    expect(interp.provider.name).toBe('test-llm');
    expect(interp.model).toBe('gpt-4o-mini');

    const resp = router.getLlm('response');
    expect(resp.model).toBe('gpt-4o');
  });

  it('resolves STT, TTS, research, and embedding providers', () => {
    const router = new ProviderRouter(buildRegistry(), buildRoutes());
    expect(router.getStt().name).toBe('test-stt');
    expect(router.getTts().name).toBe('test-tts');
    expect(router.getResearch().name).toBe('test-research');
    expect(router.getEmbedding().provider.name).toBe('test-embedding');
  });

  it('throws when a routed provider is not registered', () => {
    const emptyRegistry: ProviderRegistry = {
      llm: new Map(),
      stt: new Map(),
      tts: new Map(),
      research: new Map(),
      embedding: new Map(),
    };
    const router = new ProviderRouter(emptyRegistry, buildRoutes());

    expect(() => router.getLlm('interpretation')).toThrow('not registered');
    expect(() => router.getStt()).toThrow('not registered');
    expect(() => router.getTts()).toThrow('not registered');
    expect(() => router.getResearch()).toThrow('not registered');
    expect(() => router.getEmbedding()).toThrow('not registered');
  });

  it('throws when no route exists for a task', () => {
    const router = new ProviderRouter(buildRegistry(), []);
    expect(() => router.getLlm('interpretation')).toThrow('No provider route');
  });

  it('lists all configured routes', () => {
    const routes = buildRoutes();
    const router = new ProviderRouter(buildRegistry(), routes);
    expect(router.listRoutes()).toHaveLength(6);
  });
});
