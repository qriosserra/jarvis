import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock @tavily/core ────────────────────────────────────────────────

const mockSearch = vi.fn();
const mockExtract = vi.fn();
const mockTavilyFactory = vi.fn((_opts?: unknown) => ({
  search: mockSearch,
  extract: mockExtract,
}));

vi.mock('@tavily/core', () => ({
  tavily: (opts: unknown) => mockTavilyFactory(opts),
}));

// Import AFTER vi.mock so the SDK is replaced.
import { TavilyResearchProvider } from '../tavily.js';

// ── Tests ────────────────────────────────────────────────────────────

describe('TavilyResearchProvider', () => {
  beforeEach(() => {
    mockSearch.mockReset();
    mockExtract.mockReset();
    mockTavilyFactory.mockClear();
  });

  it('has name "tavily"', () => {
    const provider = new TavilyResearchProvider('test-key');
    expect(provider.name).toBe('tavily');
  });

  it('instantiates the SDK client with the provided API key', () => {
    new TavilyResearchProvider('test-key');
    expect(mockTavilyFactory).toHaveBeenCalledWith({ apiKey: 'test-key' });
  });

  describe('search()', () => {
    it('maps SDK results to ResearchResult[]', async () => {
      mockSearch.mockResolvedValueOnce({
        results: [
          {
            title: 'First',
            url: 'https://example.com/1',
            content: 'short snippet 1',
            rawContent: 'full content 1',
            score: 0.9,
            publishedDate: '2024-01-01',
          },
          {
            title: 'Second',
            url: 'https://example.com/2',
            content: 'short snippet 2',
            score: 0.8,
            publishedDate: '2024-01-02',
          },
        ],
      });

      const provider = new TavilyResearchProvider('test-key');
      const results = await provider.search('hello');

      expect(results).toEqual([
        {
          title: 'First',
          url: 'https://example.com/1',
          snippet: 'short snippet 1',
          content: 'full content 1',
        },
        {
          title: 'Second',
          url: 'https://example.com/2',
          snippet: 'short snippet 2',
        },
      ]);
    });

    it('passes maxResults to the SDK when provided', async () => {
      mockSearch.mockResolvedValueOnce({ results: [] });

      const provider = new TavilyResearchProvider('test-key');
      await provider.search('hello', { maxResults: 7 });

      expect(mockSearch).toHaveBeenCalledWith('hello', { maxResults: 7 });
    });

    it('omits maxResults when not provided', async () => {
      mockSearch.mockResolvedValueOnce({ results: [] });

      const provider = new TavilyResearchProvider('test-key');
      await provider.search('hello');

      expect(mockSearch).toHaveBeenCalledWith('hello', {});
    });
  });

  describe('getPageContent()', () => {
    it('returns rawContent from the first extract result', async () => {
      mockExtract.mockResolvedValueOnce({
        results: [
          {
            url: 'https://example.com/page',
            title: 'Page',
            rawContent: 'full page content',
          },
        ],
        failedResults: [],
      });

      const provider = new TavilyResearchProvider('test-key');
      const content = await provider.getPageContent('https://example.com/page');

      expect(content).toBe('full page content');
      expect(mockExtract).toHaveBeenCalledWith(['https://example.com/page']);
    });

    it('throws when extract returns no results', async () => {
      mockExtract.mockResolvedValueOnce({ results: [], failedResults: [] });

      const provider = new TavilyResearchProvider('test-key');
      await expect(
        provider.getPageContent('https://example.com/missing'),
      ).rejects.toThrow('Tavily extract returned no results');
    });
  });
});
