import type {
  LlmProvider,
  LlmMessage,
  LlmResponse,
  EmbeddingProvider,
  EmbeddingResult,
} from './types.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('provider:xai');

// ── Constants ────────────────────────────────────────────────────────

const XAI_BASE_URL = 'https://api.x.ai';

function parseHeaderMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

// ── LLM Provider ─────────────────────────────────────────────────────

export class XaiLlmProvider implements LlmProvider {
  readonly name = 'xai';
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async complete(
    messages: LlmMessage[],
    opts?: { model?: string; temperature?: number; maxTokens?: number },
  ): Promise<LlmResponse> {
    const model = opts?.model ?? 'grok-3-mini';

    const body: Record<string, unknown> = {
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    };
    if (opts?.temperature !== undefined) body.temperature = opts.temperature;
    if (opts?.maxTokens !== undefined) body.max_tokens = opts.maxTokens;

    const res = await fetch(`${XAI_BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`xAI chat completions failed (${res.status}): ${text}`);
    }

    const json = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
      model: string;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };

    const choice = json.choices?.[0];
    if (!choice) {
      throw new Error('xAI chat completions returned no choices');
    }

    return {
      content: choice.message.content,
      model: json.model,
      usage: json.usage
        ? {
            promptTokens: json.usage.prompt_tokens,
            completionTokens: json.usage.completion_tokens,
            totalTokens: json.usage.total_tokens,
          }
        : undefined,
      providerDurationMs: parseHeaderMs(res.headers.get('x-metrics-e2e-ms')),
    };
  }
}

// ── Embedding Provider ───────────────────────────────────────────────

export class XaiEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'xai';
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async embed(text: string, opts?: { model?: string }): Promise<EmbeddingResult> {
    const model = opts?.model ?? 'v2';
    const results = await this.callEmbeddingApi([text], model);
    return results[0];
  }

  async embedBatch(texts: string[], opts?: { model?: string }): Promise<EmbeddingResult[]> {
    if (texts.length === 0) return [];
    const model = opts?.model ?? 'v2';
    return this.callEmbeddingApi(texts, model);
  }

  private async callEmbeddingApi(input: string[], model: string): Promise<EmbeddingResult[]> {
    const res = await fetch(`${XAI_BASE_URL}/v1/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model,
        input,
        encoding_format: 'float',
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`xAI embeddings failed (${res.status}): ${text}`);
    }

    const json = (await res.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
      model: string;
      usage?: { total_tokens?: number };
    };

    if (!json.data || json.data.length === 0) {
      throw new Error('xAI embeddings returned no data');
    }

    // Sort by index to preserve input order
    const sorted = [...json.data].sort((a, b) => a.index - b.index);

    const providerDurationMs = parseHeaderMs(res.headers.get('x-metrics-e2e-ms'));
    const inputTokens = json.usage?.total_tokens;
    return sorted.map((d) => ({
      embedding: d.embedding,
      model: json.model,
      providerDurationMs,
      inputTokens,
    }));
  }
}

// ── Factory ──────────────────────────────────────────────────────────

export function createXaiLlmProvider(apiKey: string): XaiLlmProvider {
  logger.info('xAI LLM provider created');
  return new XaiLlmProvider(apiKey);
}

export function createXaiEmbeddingProvider(apiKey: string): XaiEmbeddingProvider {
  logger.info('xAI embedding provider created');
  return new XaiEmbeddingProvider(apiKey);
}
