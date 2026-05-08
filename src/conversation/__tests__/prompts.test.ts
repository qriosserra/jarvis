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

  it('returns empty string when no persona, language, name, or history', () => {
    expect(buildInterpretationContext(null)).toBe('');
    expect(buildInterpretationContext(null, undefined, null, [])).toBe('');
  });

  describe('requesterName and recentHistory', () => {
    it('includes requesterName when provided', () => {
      const ctx = buildInterpretationContext(null, undefined, 'Quentin');
      expect(ctx).toContain('"Quentin"');
      expect(ctx).toContain('refer to themselves indirectly');
    });

    it('omits requesterName block when null or undefined', () => {
      expect(buildInterpretationContext(null, undefined, null)).toBe('');
      expect(buildInterpretationContext(null, undefined, undefined)).toBe('');
    });

    it('renders recentHistory as User/Jarvis pairs', () => {
      const history = [
        { requestText: 'hello there', responseText: 'Hi, how can I help?' },
        { requestText: 'what time is it?', responseText: 'It is 3 PM.' },
      ];
      const ctx = buildInterpretationContext(null, undefined, null, history);
      expect(ctx).toContain('## Recent conversation');
      expect(ctx).toContain('User: hello there');
      expect(ctx).toContain('Jarvis: Hi, how can I help?');
      expect(ctx).toContain('User: what time is it?');
      expect(ctx).toContain('Jarvis: It is 3 PM.');
    });

    it('omits the recent conversation block for an empty history array', () => {
      const ctx = buildInterpretationContext(null, undefined, null, []);
      expect(ctx).not.toContain('## Recent conversation');
    });

    it('combines requesterName, persona, language, and history in one prompt', () => {
      const ctx = buildInterpretationContext(
        fakePersona(),
        'fr',
        'Quentin',
        [{ requestText: 'salut', responseText: 'Bonjour Quentin.' }],
      );
      expect(ctx).toContain('"Quentin"');
      expect(ctx).toContain('Alfred');
      expect(ctx).toContain('fr');
      expect(ctx).toContain('## Recent conversation');
      expect(ctx).toContain('User: salut');
      expect(ctx).toContain('Jarvis: Bonjour Quentin.');
    });
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
