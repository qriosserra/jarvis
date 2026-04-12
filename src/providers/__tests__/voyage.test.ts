import { describe, it, expect, vi, afterEach } from 'vitest';
import { VoyageEmbeddingProvider } from '../voyage.js';

// ── Helpers ──────────────────────────────────────────────────────────

function mockFetchResponse(body: unknown, status = 200) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }));
}

// ── VoyageEmbeddingProvider ──────────────────────────────────────────

describe('VoyageEmbeddingProvider', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sends correct request and parses single embedding', async () => {
    const responseBody = {
      data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }],
      model: 'voyage-4-lite',
    };
    globalThis.fetch = mockFetchResponse(responseBody) as any;

    const provider = new VoyageEmbeddingProvider('test-key');
    const result = await provider.embed('hello', { model: 'voyage-4-lite' });

    expect(result.embedding).toEqual([0.1, 0.2, 0.3]);
    expect(result.model).toBe('voyage-4-lite');

    const [url, opts] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe('https://api.voyageai.com/v1/embeddings');

    const headers = opts.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-key');

    const body = JSON.parse(opts.body);
    expect(body.model).toBe('voyage-4-lite');
    expect(body.input).toEqual(['hello']);
  });

  it('passes input_type when provided', async () => {
    const responseBody = {
      data: [{ embedding: [0.5], index: 0 }],
      model: 'voyage-4-lite',
    };
    globalThis.fetch = mockFetchResponse(responseBody) as any;

    const provider = new VoyageEmbeddingProvider('test-key');
    await provider.embed('hello', { model: 'voyage-4-lite', inputType: 'query' });

    const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    expect(body.input_type).toBe('query');
  });

  it('passes input_type "document" for batch', async () => {
    const responseBody = {
      data: [
        { embedding: [0.1], index: 0 },
        { embedding: [0.2], index: 1 },
      ],
      model: 'voyage-4-lite',
    };
    globalThis.fetch = mockFetchResponse(responseBody) as any;

    const provider = new VoyageEmbeddingProvider('test-key');
    await provider.embedBatch(['a', 'b'], { inputType: 'document' });

    const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    expect(body.input_type).toBe('document');
  });

  it('omits input_type when not provided', async () => {
    const responseBody = {
      data: [{ embedding: [0.5], index: 0 }],
      model: 'voyage-4-lite',
    };
    globalThis.fetch = mockFetchResponse(responseBody) as any;

    const provider = new VoyageEmbeddingProvider('test-key');
    await provider.embed('hello');

    const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    expect(body.input_type).toBeUndefined();
  });

  it('handles batch embeddings in correct order', async () => {
    const responseBody = {
      data: [
        { embedding: [0.3], index: 1 },
        { embedding: [0.1], index: 0 },
      ],
      model: 'voyage-4-lite',
    };
    globalThis.fetch = mockFetchResponse(responseBody) as any;

    const provider = new VoyageEmbeddingProvider('test-key');
    const results = await provider.embedBatch(['a', 'b']);

    expect(results).toHaveLength(2);
    // Should be sorted by index
    expect(results[0].embedding).toEqual([0.1]);
    expect(results[1].embedding).toEqual([0.3]);
  });

  it('returns empty array for empty batch', async () => {
    const provider = new VoyageEmbeddingProvider('test-key');
    const results = await provider.embedBatch([]);
    expect(results).toEqual([]);
  });

  it('throws on non-OK response', async () => {
    globalThis.fetch = mockFetchResponse({ error: 'bad' }, 500) as any;

    const provider = new VoyageEmbeddingProvider('test-key');
    await expect(provider.embed('hi')).rejects.toThrow('Voyage embeddings failed (500)');
  });

  it('throws when no data returned', async () => {
    globalThis.fetch = mockFetchResponse({ data: [] }) as any;

    const provider = new VoyageEmbeddingProvider('test-key');
    await expect(provider.embed('hi')).rejects.toThrow('no data');
  });

  it('defaults model to voyage-4-lite', async () => {
    const responseBody = {
      data: [{ embedding: [0.1], index: 0 }],
      model: 'voyage-4-lite',
    };
    globalThis.fetch = mockFetchResponse(responseBody) as any;

    const provider = new VoyageEmbeddingProvider('test-key');
    await provider.embed('hello');

    const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    expect(body.model).toBe('voyage-4-lite');
  });

  it('has name "voyage"', () => {
    const provider = new VoyageEmbeddingProvider('k');
    expect(provider.name).toBe('voyage');
  });
});
