import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isAddressedToJarvis, stripBotNamePrefix } from '../voice/speech-detect.js';
import type { SpeakerUtterance } from '../voice/types.js';

// ── Voice detection integration tests ────────────────────────────────
// These exercise the voice entry-point logic without a real Discord
// connection. The full handleVoiceUtterance function requires a live
// container + Discord guild lookup, so we test the addressability and
// stripping logic with realistic transcript fixtures.

describe('voice flow — addressed speech detection', () => {
  const fixtures: Array<{ transcript: string; addressed: boolean; stripped: string }> = [
    {
      transcript: 'Jarvis, what is the weather today?',
      addressed: true,
      stripped: 'what is the weather today?',
    },
    {
      transcript: 'Hey Jarvis can you mute Dave',
      addressed: true,
      stripped: 'can you mute Dave',
    },
    {
      transcript: 'ok jarvis rename Bob to Bobby',
      addressed: true,
      stripped: 'rename Bob to Bobby',
    },
    {
      transcript: 'Did anyone see the game last night',
      addressed: false,
      stripped: 'Did anyone see the game last night',
    },
    {
      transcript: 'I was talking to jarvis earlier',
      addressed: true,
      stripped: 'I was talking to jarvis earlier',
    },
    {
      transcript: 'JARVIS join the gaming channel',
      addressed: true,
      stripped: 'join the gaming channel',
    },
  ];

  for (const { transcript, addressed, stripped } of fixtures) {
    it(`"${transcript.slice(0, 40)}…" → addressed=${addressed}`, () => {
      expect(isAddressedToJarvis(transcript)).toBe(addressed);
    });

    if (addressed) {
      it(`strips prefix from "${transcript.slice(0, 40)}…"`, () => {
        expect(stripBotNamePrefix(transcript)).toBe(stripped);
      });
    }
  }
});

describe('voice flow — speaker utterance model', () => {
  it('carries all required fields', () => {
    const utterance: SpeakerUtterance = {
      userId: 'u1',
      guildId: 'g1',
      channelId: 'vc-1',
      transcript: 'Jarvis, play some music',
      language: 'en',
      confidence: 0.95,
      speechEndMs: Date.now(),
    };

    expect(utterance.userId).toBe('u1');
    expect(utterance.language).toBe('en');
    expect(utterance.confidence).toBeGreaterThan(0.9);
  });
});

describe('voice flow — unaddressed speech is ignored', () => {
  it('returns false for ambient conversation', () => {
    const transcripts = [
      'pass me the salt',
      'what do you think about that',
      'yeah I agree with you',
      'let me check my phone',
    ];

    for (const t of transcripts) {
      expect(isAddressedToJarvis(t)).toBe(false);
    }
  });
});
