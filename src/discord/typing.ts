import type { TextBasedChannel } from 'discord.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('discord-typing');

/**
 * Discord shows the typing indicator for up to 10 seconds after each
 * `sendTyping()` call.  Refreshing slightly before that window expires
 * keeps the indicator alive throughout long-running operations without
 * wasting API calls.
 */
const TYPING_REFRESH_INTERVAL_MS = 9_000;

/**
 * Run an async operation while showing the Discord "is typing..."
 * indicator in the given channel.
 *
 * The indicator starts immediately, refreshes on a timer until the
 * operation settles, and is cleared in `finally`.  Discord automatically
 * dismisses the indicator the moment the bot posts a message, so the
 * caller does not need to manage it explicitly.
 *
 * `sendTyping()` errors are swallowed (e.g. missing permissions) — a
 * cosmetic indicator must never crash the surrounding flow.
 */
export async function withTypingIndicator<T>(
  channel: TextBasedChannel,
  operation: () => Promise<T>,
): Promise<T> {
  triggerTypingIndicator(channel);

  const refreshHandle = setInterval(
    () => triggerTypingIndicator(channel),
    TYPING_REFRESH_INTERVAL_MS,
  );

  try {
    return await operation();
  } finally {
    clearInterval(refreshHandle);
  }
}

function triggerTypingIndicator(channel: TextBasedChannel): void {
  const channelWithTyping = channel as { sendTyping?: () => Promise<void> };
  if (typeof channelWithTyping.sendTyping !== 'function') return;

  channelWithTyping.sendTyping().catch((err) => {
    logger.debug(
      { err, channelId: (channel as { id?: string }).id },
      'sendTyping failed (non-fatal)',
    );
  });
}
