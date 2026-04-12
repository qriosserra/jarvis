import { Readable } from 'node:stream';
import {
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  StreamType,
  type VoiceConnection,
  type AudioPlayer,
} from '@discordjs/voice';
import type { TtsProvider, TtsResult } from '../providers/types.js';
import { createLogger } from '../lib/logger.js';
import { trackOperation } from '../lib/latency-tracker.js';
import {
  ttsLatency,
  voiceAckLatency,
  voiceResponseLatency,
  voiceAckUsedCounter,
} from '../lib/metrics.js';

const logger = createLogger('voice-playback');

// ── Prebuilt acknowledgement phrases ────────────────────────────────

const ACK_PHRASES = [
  'One moment.',
  'Let me check.',
  'Working on it.',
  'Just a second.',
  'On it.',
];

function randomAckPhrase(): string {
  return ACK_PHRASES[Math.floor(Math.random() * ACK_PHRASES.length)];
}

// ── Player pool per connection ──────────────────────────────────────

const players = new Map<string, AudioPlayer>();

function getOrCreatePlayer(connection: VoiceConnection, guildId: string): AudioPlayer {
  let player = players.get(guildId);
  if (!player) {
    player = createAudioPlayer();
    players.set(guildId, player);
    connection.subscribe(player);

    player.on('error', (err) => {
      logger.error({ guildId, err: err.message }, 'Audio player error');
    });
  }
  return player;
}

/** Remove a player when a connection is torn down. */
export function destroyPlayer(guildId: string): void {
  const player = players.get(guildId);
  if (player) {
    player.stop(true);
    players.delete(guildId);
  }
}

// ── Core playback ───────────────────────────────────────────────────

/**
 * Synthesize text and play it through the voice connection.
 *
 * Returns a `LatencyInfo` with timing data. Resolves when playback
 * finishes or errors.
 */
export async function speak(
  connection: VoiceConnection,
  guildId: string,
  text: string,
  ttsProvider: TtsProvider,
  opts?: { voice?: string; language?: string },
): Promise<LatencyInfo> {
  const { result: ttsResult, durationMs: synthMs } = await trackOperation(
    {
      operationName: 'tts_synthesis',
      operationType: 'tts',
      providerName: ttsProvider.name,
      metadata: { textLength: text.length, guildId },
    },
    () => ttsProvider.synthesize(text, opts),
  );
  ttsLatency.record(synthMs, { provider: ttsProvider.name });

  const playStart = Date.now();
  await playAudio(connection, guildId, ttsResult);
  const playEnd = Date.now();

  const info: LatencyInfo = {
    synthesisMs: synthMs,
    playbackMs: playEnd - playStart,
    totalMs: synthMs + (playEnd - playStart),
  };

  logger.info(
    { guildId, synthesisMs: info.synthesisMs, playbackMs: info.playbackMs, totalMs: info.totalMs },
    'Playback complete',
  );

  return info;
}

/**
 * Play a short acknowledgement phrase through the voice connection.
 * Used when the full answer will take longer than the latency target.
 */
export async function speakAcknowledgement(
  connection: VoiceConnection,
  guildId: string,
  ttsProvider: TtsProvider,
  opts?: { voice?: string; language?: string },
): Promise<LatencyInfo> {
  return speak(connection, guildId, randomAckPhrase(), ttsProvider, opts);
}

/**
 * Orchestrate the acknowledgement-or-answer flow:
 *
 * 1. Start generating the full response (via `responseFn`).
 * 2. If the response resolves within `timeoutMs`, play it directly.
 * 3. Otherwise, play a short ack, then play the full response when ready.
 *
 * Returns a `TimedResponse` with the response text and latency info.
 */
export async function speakWithAcknowledgement(
  connection: VoiceConnection,
  guildId: string,
  ttsProvider: TtsProvider,
  responseFn: () => Promise<string>,
  speechEndMs: number,
  opts?: { timeoutMs?: number; voice?: string; language?: string },
): Promise<TimedResponse> {
  const timeoutMs = opts?.timeoutMs ?? 2000;
  const ttsOpts = { voice: opts?.voice, language: opts?.language };

  // Race the response against the timeout
  const responsePromise = responseFn();

  const result = await Promise.race([
    responsePromise.then((text) => ({ text, timedOut: false as const })),
    sleep(timeoutMs).then(() => ({ text: null, timedOut: true as const })),
  ]);

  if (!result.timedOut && result.text) {
    // Fast path — answer arrived within the target
    const latency = await speak(connection, guildId, result.text, ttsProvider, ttsOpts);
    const endToEndMs = Date.now() - speechEndMs;
    voiceResponseLatency.record(endToEndMs, { path: 'fast' });
    return {
      responseText: result.text,
      usedAcknowledgement: false,
      endToEndMs,
      latency,
    };
  }

  // Slow path — play ack, then wait for full response
  const ackLatencyInfo = await speakAcknowledgement(connection, guildId, ttsProvider, ttsOpts);
  const ackEndToEndMs = Date.now() - speechEndMs;
  voiceAckLatency.record(ackEndToEndMs);
  voiceAckUsedCounter.add(1);

  logger.info(
    { guildId, ackEndToEndMs },
    'Acknowledgement played, waiting for full response',
  );

  const responseText = await responsePromise;
  const responseLatency = await speak(connection, guildId, responseText, ttsProvider, ttsOpts);
  const endToEndMs = Date.now() - speechEndMs;
  voiceResponseLatency.record(endToEndMs, { path: 'slow' });

  return {
    responseText,
    usedAcknowledgement: true,
    endToEndMs,
    ackEndToEndMs,
    latency: responseLatency,
    ackLatency: ackLatencyInfo,
  };
}

// ── Audio resource playback ─────────────────────────────────────────

function playAudio(
  connection: VoiceConnection,
  guildId: string,
  ttsResult: TtsResult,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const player = getOrCreatePlayer(connection, guildId);

    const readable = Readable.from(ttsResult.audio);
    const resource = createAudioResource(readable, {
      inputType: ttsResult.format === 'opus' ? StreamType.Opus : StreamType.Raw,
    });

    const onIdle = () => {
      cleanup();
      resolve();
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      player.off(AudioPlayerStatus.Idle, onIdle);
      player.off('error', onError);
    };

    player.on(AudioPlayerStatus.Idle, onIdle);
    player.on('error', onError);

    player.play(resource);
  });
}

// ── Types ───────────────────────────────────────────────────────────

export interface LatencyInfo {
  /** TTS synthesis duration (ms). */
  synthesisMs: number;
  /** Audio playback duration (ms). */
  playbackMs: number;
  /** Total (synthesis + playback) duration (ms). */
  totalMs: number;
}

export interface TimedResponse {
  /** The full response text that was spoken. */
  responseText: string;
  /** Whether an acknowledgement was played before the answer. */
  usedAcknowledgement: boolean;
  /** Total ms from end of user speech to end of Jarvis output. */
  endToEndMs: number;
  /** Ms from end of user speech to start of ack (only if ack was used). */
  ackEndToEndMs?: number;
  /** Latency info for the main response. */
  latency: LatencyInfo;
  /** Latency info for the acknowledgement (only if ack was used). */
  ackLatency?: LatencyInfo;
}

// ── Helpers ─────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
