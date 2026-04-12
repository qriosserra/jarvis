import { createLogger } from '../lib/logger.js';
import type { EmbeddingProvider, EmbeddingResult } from './types.js';

const logger = createLogger('provider:voyage');

const VOYAGE_BASE_URL = 'https://api.voyageai.com';

// ── Embedding Provider ───────────────────────────────────────────────

export class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'voyage';
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async embed(
    text: string,
    opts?: { model?: string; inputType?: 'query' | 'document' },
  ): Promise<EmbeddingResult> {
    const model = opts?.model ?? 'voyage-4-lite';
    const results = await this.callEmbeddingApi([text], model, opts?.inputType);
    return results[0];
  }

  async embedBatch(
    texts: string[],
    opts?: { model?: string; inputType?: 'query' | 'document' },
  ): Promise<EmbeddingResult[]> {
    if (texts.length === 0) return [];
    const model = opts?.model ?? 'voyage-4-lite';
    return this.callEmbeddingApi(texts, model, opts?.inputType);
  }

  private async callEmbeddingApi(
    input: string[],
    model: string,
    inputType?: 'query' | 'document',
  ): Promise<EmbeddingResult[]> {
    const body: Record<string, unknown> = {
      model,
      input,
    };

    if (inputType) {
      body.input_type = inputType;
    }

    const res = await fetch(`${VOYAGE_BASE_URL}/v1/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Voyage embeddings failed (${res.status}): ${text}`);
    }

    const json = (await res.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
      model: string;
    };

    if (!json.data || json.data.length === 0) {
      throw new Error('Voyage embeddings returned no data');
    }

    // Sort by index to preserve input order
    const sorted = [...json.data].sort((a, b) => a.index - b.index);

    return sorted.map((d) => ({
      embedding: d.embedding,
      model: json.model,
    }));
  }
}

// ── Factory ──────────────────────────────────────────────────────────

export function createVoyageEmbeddingProvider(apiKey: string): VoyageEmbeddingProvider {
  logger.info('Voyage embedding provider created');
  return new VoyageEmbeddingProvider(apiKey);
}
