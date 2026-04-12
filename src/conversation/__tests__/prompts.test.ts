import { describe, it, expect } from 'vitest';
import {
  buildInterpretationContext,
  buildResponseSystemPrompt,
  buildResearchContext,
  INTERPRETATION_SYSTEM_PROMPT,
} from '../prompts.js';
import { IntentKind, ALL_INTENT_KINDS } from '../../interaction/intent.js';
import type { Persona } from '../../db/types.js';

// ── Helpers ──────────────────────────────────────────────────────────

function fakePersona(overrides?: Partial<Persona>): Persona {
  return {
    id: 'p1',
    name: 'Alfred',
    description: 'A butler persona',
    systemPrompt: 'You are Alfred, a refined butler.',
    responseStyle: { tone: 'formal' },
    isDefault: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('INTERPRETATION_SYSTEM_PROMPT', () => {
  it('includes all intent kinds', () => {
    for (const kind of ALL_INTENT_KINDS) {
      expect(INTERPRETATION_SYSTEM_PROMPT).toContain(kind);
    }
  });
});

describe('buildInterpretationContext', () => {
  it('includes persona name when persona is provided', () => {
    const ctx = buildInterpretationContext(fakePersona(), 'en');
    expect(ctx).toContain('Alfred');
  });

  it('includes language hint when provided', () => {
    const ctx = buildInterpretationContext(null, 'nl');
    expect(ctx).toContain('nl');
  });

  it('returns empty string when no persona or language', () => {
    expect(buildInterpretationContext(null)).toBe('');
  });
});

describe('buildResponseSystemPrompt', () => {
  it('uses persona system prompt and name when provided', () => {
    const prompt = buildResponseSystemPrompt(fakePersona());
    expect(prompt).toContain('You are Alfred, a refined butler.');
    expect(prompt).toContain('"Alfred"');
  });

  it('uses persona response style', () => {
    const prompt = buildResponseSystemPrompt(fakePersona());
    expect(prompt).toContain('tone');
    expect(prompt).toContain('formal');
  });

  it('uses default Jarvis persona when no persona', () => {
    const prompt = buildResponseSystemPrompt(null);
    expect(prompt).toContain('Jarvis');
    expect(prompt).not.toContain('Alfred');
  });

  it('includes non-English language instruction', () => {
    const prompt = buildResponseSystemPrompt(null, 'nl');
    expect(prompt).toContain('nl');
    expect(prompt).toContain('same language');
  });

  it('omits language instruction for English', () => {
    const prompt = buildResponseSystemPrompt(null, 'en');
    expect(prompt).not.toContain('same language');
  });
});

describe('buildResearchContext', () => {
  it('returns empty string for no results', () => {
    expect(buildResearchContext([])).toBe('');
  });

  it('formats results with title, url, snippet', () => {
    const results = [
      { title: 'Result 1', url: 'https://example.com', snippet: 'A snippet' },
    ];
    const ctx = buildResearchContext(results);
    expect(ctx).toContain('Result 1');
    expect(ctx).toContain('https://example.com');
    expect(ctx).toContain('A snippet');
    expect(ctx).toContain('Cite sources');
  });

  it('truncates content to 800 characters', () => {
    const results = [
      { title: 'Long', url: 'https://x.com', snippet: 'short', content: 'x'.repeat(2000) },
    ];
    const ctx = buildResearchContext(results);
    // Should contain content, not snippet, but truncated
    expect(ctx).not.toContain('short');
    expect(ctx.length).toBeLessThan(2500);
  });

  it('limits to 5 results', () => {
    const results = Array.from({ length: 8 }, (_, i) => ({
      title: `R${i}`,
      url: `https://r${i}.com`,
      snippet: `s${i}`,
    }));
    const ctx = buildResearchContext(results);
    expect(ctx).toContain('R4');
    expect(ctx).not.toContain('R5');
  });
});
