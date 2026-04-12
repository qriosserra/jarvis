import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkMemorySafety, checkMemberIdentitySafety } from '../safety.js';
import type { InteractionContext } from '../../interaction/types.js';
import { IntentKind, type IntentOutcome } from '../../interaction/intent.js';
import type { IdentityAlias } from '../../db/types.js';

// ── Mock identity module ─────────────────────────────────────────────

vi.mock('../identity.js', () => ({
  getAllKnownNames: vi.fn(async () => []),
}));

import { getAllKnownNames } from '../identity.js';
const mockGetAllKnownNames = vi.mocked(getAllKnownNames);

// ── Helpers ──────────────────────────────────────────────────────────

function fakeCtx(overrides?: Partial<InteractionContext>): InteractionContext {
  return {
    correlationId: 'corr-1',
    guildId: 'g1',
    guildName: 'Test Guild',
    channelId: 'ch1',
    surface: 'text',
    requester: { id: 'u1', username: 'alice', displayName: 'Alice' },
    requestText: 'rename bob to bobby',
    trigger: 'mention',
    timestamp: new Date(),
    ...overrides,
  };
}

function fakeAlias(overrides?: Partial<IdentityAlias>): IdentityAlias {
  return {
    id: 'a1',
    memberId: 'u2',
    guildId: 'g1',
    aliasType: 'preferred_name',
    value: 'Bob',
    source: 'explicit',
    confidence: 1.0,
    confirmed: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('checkMemorySafety', () => {
  it('returns safe for non-member-referencing intents', async () => {
    const result = await checkMemorySafety(fakeCtx(), { kind: IntentKind.Respond });
    expect(result.safe).toBe(true);
  });

  it('returns safe for join-voice (no targetRef)', async () => {
    const result = await checkMemorySafety(fakeCtx(), {
      kind: IntentKind.JoinVoice,
      channelRef: 'general',
    });
    expect(result.safe).toBe(true);
  });

  it('returns safe for member-referencing intents when no aliases found', async () => {
    const result = await checkMemorySafety(fakeCtx(), {
      kind: IntentKind.RenameMember,
      targetRef: 'bob',
      newName: 'bobby',
    });
    expect(result.safe).toBe(true);
  });
});

describe('checkMemberIdentitySafety', () => {
  beforeEach(() => {
    mockGetAllKnownNames.mockReset();
  });

  it('returns safe when no aliases exist', async () => {
    mockGetAllKnownNames.mockResolvedValue([]);
    const result = await checkMemberIdentitySafety('u2', 'g1', 'bob');
    expect(result.safe).toBe(true);
  });

  it('detects conflicting confirmed names of the same type', async () => {
    mockGetAllKnownNames.mockResolvedValue([
      fakeAlias({ value: 'Robert', aliasType: 'preferred_name', confirmed: true }),
      fakeAlias({ id: 'a2', value: 'Bobby', aliasType: 'preferred_name', confirmed: true }),
    ]);
    const result = await checkMemberIdentitySafety('u2', 'g1', 'bob');
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('conflicting');
  });

  it('does not flag non-conflicting aliases of different types', async () => {
    mockGetAllKnownNames.mockResolvedValue([
      fakeAlias({ value: 'Robert', aliasType: 'preferred_name', confirmed: true }),
      fakeAlias({ id: 'a2', value: 'Bobby', aliasType: 'nickname', confirmed: true }),
    ]);
    const result = await checkMemberIdentitySafety('u2', 'g1', 'bob');
    expect(result.safe).toBe(true);
  });

  it('detects stale + low-confidence + unconfirmed data', async () => {
    const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000); // 40 days ago
    mockGetAllKnownNames.mockResolvedValue([
      fakeAlias({ confidence: 0.5, confirmed: false, updatedAt: oldDate }),
    ]);
    const result = await checkMemberIdentitySafety('u2', 'g1', 'bob');
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('outdated');
  });

  it('does not flag stale but high-confidence data', async () => {
    const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    mockGetAllKnownNames.mockResolvedValue([
      fakeAlias({ confidence: 0.9, confirmed: false, updatedAt: oldDate }),
    ]);
    const result = await checkMemberIdentitySafety('u2', 'g1', 'bob');
    expect(result.safe).toBe(true);
  });

  it('does not flag stale + low-confidence but confirmed data', async () => {
    const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    mockGetAllKnownNames.mockResolvedValue([
      fakeAlias({ confidence: 0.5, confirmed: true, updatedAt: oldDate }),
    ]);
    const result = await checkMemberIdentitySafety('u2', 'g1', 'bob');
    expect(result.safe).toBe(true);
  });

  it('returns safe when getAllKnownNames throws', async () => {
    mockGetAllKnownNames.mockRejectedValue(new Error('db down'));
    const result = await checkMemberIdentitySafety('u2', 'g1', 'bob');
    expect(result.safe).toBe(true);
  });
});
