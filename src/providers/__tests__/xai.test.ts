import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { XaiLlmProvider, XaiEmbeddingProvider } from '../xai.js';

// ── Helpers ──────────────────────────────────────────────────────────

function mockFetchResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  }));
}

// ── XaiLlmProvider ───────────────────────────────────────────────────

describe('XaiLlmProvider', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sends correct request and parses response', async () => {
    const responseBody = {
      choices: [{ message: { content: 'Hello world' } }],
      model: 'grok-3-mini',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
    globalThis.fetch = mockFetchResponse(responseBody, 200, { 'x-metrics-e2e-ms': '123' }) as any;

    const provider = new XaiLlmProvider('test-key');
    const result = await provider.complete(
      [{ role: 'user', content: 'hi' }],
      { model: 'grok-3-mini', temperature: 0.5, maxTokens: 100 },
    );

    expect(result.content).toBe('Hello world');
    expect(result.model).toBe('grok-3-mini');
    expect(result.usage).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
    expect(result.providerDurationMs).toBe(123);

    // Verify fetch was called with correct args
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    const [url, opts] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe('https://api.x.ai/v1/chat/completions');
    expect(opts.method).toBe('POST');

    const headers = opts.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-key');

    const body = JSON.parse(opts.body);
    expect(body.model).toBe('grok-3-mini');
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(body.temperature).toBe(0.5);
    expect(body.max_tokens).toBe(100);
  });

  it('throws on non-OK response', async () => {
    globalThis.fetch = mockFetchResponse({ error: 'bad' }, 401) as any;

    const provider = new XaiLlmProvider('bad-key');
    await expect(
      provider.complete([{ role: 'user', content: 'hi' }]),
    ).rejects.toThrow('xAI chat completions failed (401)');
  });

  it('throws when no choices returned', async () => {
    globalThis.fetch = mockFetchResponse({ choices: [] }) as any;

    const provider = new XaiLlmProvider('test-key');
    await expect(
      provider.complete([{ role: 'user', content: 'hi' }]),
    ).rejects.toThrow('no choices');
  });

  it('has name "xai"', () => {
    const provider = new XaiLlmProvider('k');
    expect(provider.name).toBe('xai');
  });
});

// ── XaiEmbeddingProvider ─────────────────────────────────────────────

describe('XaiEmbeddingProvider', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sends correct request and parses single embedding', async () => {
    const responseBody = {
      data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }],
      model: 'v2',
    };
    globalThis.fetch = mockFetchResponse(responseBody, 200, { 'x-metrics-e2e-ms': '87' }) as any;

    const provider = new XaiEmbeddingProvider('test-key');
    const result = await provider.embed('hello', { model: 'v2' });

    expect(result.embedding).toEqual([0.1, 0.2, 0.3]);
    expect(result.model).toBe('v2');
    expect(result.providerDurationMs).toBe(87);

    const [url, opts] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe('https://api.x.ai/v1/embeddings');

    const body = JSON.parse(opts.body);
    expect(body.model).toBe('v2');
    expect(body.input).toEqual(['hello']);
    expect(body.encoding_format).toBe('float');
  });

  it('handles batch embeddings in correct order', async () => {
    const responseBody = {
      data: [
        { embedding: [0.3], index: 1 },
        { embedding: [0.1], index: 0 },
      ],
      model: 'v2',
    };
    globalThis.fetch = mockFetchResponse(responseBody, 200, {}) as any;

    const provider = new XaiEmbeddingProvider('test-key');
    const results = await provider.embedBatch(['a', 'b']);

    expect(results).toHaveLength(2);
    // Should be sorted by index
    expect(results[0].embedding).toEqual([0.1]);
    expect(results[1].embedding).toEqual([0.3]);
  });

  it('returns empty array for empty batch', async () => {
    const provider = new XaiEmbeddingProvider('test-key');
    const results = await provider.embedBatch([]);
    expect(results).toEqual([]);
  });

  it('throws on non-OK response', async () => {
    globalThis.fetch = mockFetchResponse({ error: 'bad' }, 500) as any;

    const provider = new XaiEmbeddingProvider('test-key');
    await expect(provider.embed('hi')).rejects.toThrow('xAI embeddings failed (500)');
  });

  it('throws when no data returned', async () => {
    globalThis.fetch = mockFetchResponse({ data: [] }) as any;

    const provider = new XaiEmbeddingProvider('test-key');
    await expect(provider.embed('hi')).rejects.toThrow('no data');
  });

  it('has name "xai"', () => {
    const provider = new XaiEmbeddingProvider('k');
    expect(provider.name).toBe('xai');
  });
});
