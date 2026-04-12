import { describe, it, expect } from 'vitest';
import {
  IntentKind,
  isDeterministicIntent,
  DETERMINISTIC_INTENT_KINDS,
  type IntentOutcome,
} from '../intent.js';

describe('isDeterministicIntent', () => {
  const deterministicKinds: IntentOutcome['kind'][] = [
    IntentKind.JoinVoice,
    IntentKind.MoveMember,
    IntentKind.MuteMember,
    IntentKind.DeafenMember,
    IntentKind.RenameMember,
    IntentKind.SendTextMessage,
  ];

  const conversationalKinds: IntentOutcome['kind'][] = [
    IntentKind.Respond,
    IntentKind.AskClarification,
    IntentKind.ResearchAndRespond,
  ];

  for (const kind of deterministicKinds) {
    it(`returns true for ${kind}`, () => {
      expect(isDeterministicIntent({ kind } as IntentOutcome)).toBe(true);
    });
  }

  for (const kind of conversationalKinds) {
    it(`returns false for ${kind}`, () => {
      expect(isDeterministicIntent({ kind } as IntentOutcome)).toBe(false);
    });
  }
});

describe('DETERMINISTIC_INTENT_KINDS', () => {
  it('contains exactly 6 entries', () => {
    expect(DETERMINISTIC_INTENT_KINDS.size).toBe(6);
  });
});
