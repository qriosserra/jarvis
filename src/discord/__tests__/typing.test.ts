import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TextBasedChannel } from 'discord.js';
import { withTypingIndicator } from '../typing.js';

// ── Test helpers ─────────────────────────────────────────────────────

interface FakeChannel {
  id: string;
  sendTyping: ReturnType<typeof vi.fn>;
}

function createFakeChannel(sendTyping?: ReturnType<typeof vi.fn>): FakeChannel {
  return {
    id: 'ch-1',
    sendTyping: sendTyping ?? vi.fn(async () => {}),
  };
}

function asChannel(channel: FakeChannel | { id: string }): TextBasedChannel {
  return channel as unknown as TextBasedChannel;
}

// ── Tests ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('withTypingIndicator', () => {
  it('triggers sendTyping immediately and returns the operation result', async () => {
    const channel = createFakeChannel();

    const result = await withTypingIndicator(asChannel(channel), async () => 'done');

    expect(result).toBe('done');
    expect(channel.sendTyping).toHaveBeenCalledTimes(1);
  });

  it('refreshes the typing indicator while the operation runs', async () => {
    const channel = createFakeChannel();

    const promise = withTypingIndicator(asChannel(channel), async () => {
      // Advance past two refresh intervals (9s each) before resolving.
      await vi.advanceTimersByTimeAsync(20_000);
      return 'done';
    });

    await promise;

    // 1 immediate call + 2 refreshes within the 20s window.
    expect(channel.sendTyping).toHaveBeenCalledTimes(3);
  });

  it('clears the refresh interval after the operation settles', async () => {
    const channel = createFakeChannel();

    await withTypingIndicator(asChannel(channel), async () => 'done');

    channel.sendTyping.mockClear();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(channel.sendTyping).not.toHaveBeenCalled();
  });

  it('clears the refresh interval and rethrows when the operation throws', async () => {
    const channel = createFakeChannel();
    const failure = new Error('boom');

    await expect(
      withTypingIndicator(asChannel(channel), async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    channel.sendTyping.mockClear();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(channel.sendTyping).not.toHaveBeenCalled();
  });

  it('does not surface sendTyping errors to the caller', async () => {
    const channel = createFakeChannel(
      vi.fn(async () => {
        throw new Error('Missing Permissions');
      }),
    );

    const result = await withTypingIndicator(asChannel(channel), async () => 'ok');

    expect(result).toBe('ok');
    expect(channel.sendTyping).toHaveBeenCalled();
  });

  it('skips silently when the channel does not support sendTyping', async () => {
    const channel = { id: 'voice-channel' };

    const result = await withTypingIndicator(asChannel(channel), async () => 'ok');

    expect(result).toBe('ok');
  });
});
