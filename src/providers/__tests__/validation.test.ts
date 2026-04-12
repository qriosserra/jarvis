import { describe, it, expect } from 'vitest';
import { validateProviderConfig, validateProviderRegistry } from '../validation.js';
import type { AppConfig } from '../../config/env.js';
import type { ProviderRegistry } from '../router.js';

// ── Helpers ──────────────────────────────────────────────────────────

function baseConfig(overrides?: Partial<AppConfig>): AppConfig {
  return {
    env: 'test',
    logLevel: 'warn',
    discord: { token: 'tok', clientId: 'cid' },
    database: { url: 'postgresql://localhost/test' },
    redis: { url: 'redis://localhost' },
    llm: {
      interpretation: { provider: 'xai', model: 'grok-3-mini' },
      response: { provider: 'xai', model: 'grok-3-mini' },
      embedding: { provider: 'voyage', model: 'voyage-4-lite' },
    },
    stt: { provider: 'deepgram' },
    tts: { provider: 'cartesia' },
    research: { provider: 'tavily' },
    persona: { default: 'jarvis' },
    secrets: {
      xaiApiKey: 'xai-test',
      voyageApiKey: 'voyage-test',
      deepgramApiKey: 'dg-test',
      cartesiaApiKey: 'ca-test',
      tavilyApiKey: 'tv-test',
    },
    ...overrides,
  };
}

function emptyRegistry(): ProviderRegistry {
  return {
    llm: new Map(),
    stt: new Map(),
    tts: new Map(),
    research: new Map(),
    embedding: new Map(),
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('validateProviderConfig', () => {
  it('passes when all secrets are present', () => {
    const result = validateProviderConfig(baseConfig());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('fails when xAI key is missing but provider is routed', () => {
    const cfg = baseConfig({ secrets: { voyageApiKey: 'x', deepgramApiKey: 'x', cartesiaApiKey: 'x', tavilyApiKey: 'x' } });
    const result = validateProviderConfig(cfg);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('XAI_API_KEY'))).toBe(true);
  });

  it('fails when Voyage key is missing but voyage embedding is routed', () => {
    const cfg = baseConfig({ secrets: { xaiApiKey: 'x', deepgramApiKey: 'x', cartesiaApiKey: 'x', tavilyApiKey: 'x' } });
    const result = validateProviderConfig(cfg);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('VOYAGE_API_KEY'))).toBe(true);
  });

  it('fails when OpenAI key is missing but openai provider is routed', () => {
    const cfg = baseConfig({
      llm: {
        interpretation: { provider: 'openai', model: 'gpt-4o-mini' },
        response: { provider: 'openai', model: 'gpt-4o' },
        embedding: { provider: 'openai', model: 'text-embedding-3-small' },
      },
      secrets: { deepgramApiKey: 'x', cartesiaApiKey: 'x', tavilyApiKey: 'x', voyageApiKey: 'x' },
    });
    const result = validateProviderConfig(cfg);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('OPENAI_API_KEY'))).toBe(true);
  });

  it('fails when Deepgram key is missing', () => {
    const cfg = baseConfig({ secrets: { xaiApiKey: 'x', voyageApiKey: 'x', cartesiaApiKey: 'x', tavilyApiKey: 'x' } });
    const result = validateProviderConfig(cfg);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('DEEPGRAM_API_KEY'))).toBe(true);
  });

  it('passes when provider is not routed and key is missing', () => {
    const cfg = baseConfig({
      stt: { provider: 'custom-stt' },
      secrets: { xaiApiKey: 'x', voyageApiKey: 'x', cartesiaApiKey: 'x', tavilyApiKey: 'x' },
    });
    const result = validateProviderConfig(cfg);
    // deepgram not routed, so missing key should not cause failure
    expect(result.errors.some((e) => e.includes('DEEPGRAM_API_KEY'))).toBe(false);
  });

  it('passes when xai provider is not routed and xai key is missing', () => {
    const cfg = baseConfig({
      llm: {
        interpretation: { provider: 'openai', model: 'gpt-4o-mini' },
        response: { provider: 'openai', model: 'gpt-4o' },
        embedding: { provider: 'openai', model: 'text-embedding-3-small' },
      },
      secrets: { openaiApiKey: 'x', deepgramApiKey: 'x', cartesiaApiKey: 'x', tavilyApiKey: 'x', voyageApiKey: 'x' },
    });
    const result = validateProviderConfig(cfg);
    expect(result.errors.some((e) => e.includes('XAI_API_KEY'))).toBe(false);
  });
});

describe('validateProviderRegistry', () => {
  it('fails when registry is empty but routes are configured', () => {
    const cfg = baseConfig();
    const result = validateProviderRegistry(cfg, emptyRegistry());
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('passes when all routed providers are registered', () => {
    const stubProvider = { name: 'xai' } as any;
    const stubStt = { name: 'deepgram' } as any;
    const stubTts = { name: 'cartesia' } as any;
    const stubResearch = { name: 'tavily' } as any;
    const stubVoyage = { name: 'voyage' } as any;

    const registry: ProviderRegistry = {
      llm: new Map([['xai', stubProvider]]),
      stt: new Map([['deepgram', stubStt]]),
      tts: new Map([['cartesia', stubTts]]),
      research: new Map([['tavily', stubResearch]]),
      embedding: new Map([['voyage', stubVoyage]]),
    };

    const result = validateProviderRegistry(baseConfig(), registry);
    expect(result.valid).toBe(true);
  });
});
