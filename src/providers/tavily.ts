import { tavily, type TavilyClient } from '@tavily/core';
import { createLogger } from '../lib/logger.js';
import type { ResearchProvider, ResearchResult } from './types.js';

const logger = createLogger('provider:tavily');

// ── Research Provider ────────────────────────────────────────────────

export class TavilyResearchProvider implements ResearchProvider {
  readonly name = 'tavily';
  private readonly client: TavilyClient;

  constructor(apiKey: string) {
    this.client = tavily({ apiKey });
  }

  async search(query: string, opts?: { maxResults?: number }): Promise<ResearchResult[]> {
    const response = await this.client.search(query, {
      ...(opts?.maxResults !== undefined ? { maxResults: opts.maxResults } : {}),
    });

    return response.results.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
      ...(r.rawContent !== undefined ? { content: r.rawContent } : {}),
    }));
  }

  async getPageContent(url: string): Promise<string> {
    const response = await this.client.extract([url]);

    const first = response.results[0];
    if (!first) {
      throw new Error(`Tavily extract returned no results for ${url}`);
    }

    return first.rawContent;
  }
}

// ── Factory ──────────────────────────────────────────────────────────

export function createTavilyResearchProvider(apiKey: string): TavilyResearchProvider {
  logger.info('Tavily research provider created');
  return new TavilyResearchProvider(apiKey);
}
