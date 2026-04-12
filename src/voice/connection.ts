import {
  type VoiceConnection,
  VoiceConnectionStatus,
  joinVoiceChannel,
  entersState,
  EndBehaviorType,
  type DiscordGatewayAdapterCreator,
} from '@discordjs/voice';
import { createLogger } from '../lib/logger.js';
import { SpeakerPipeline } from './audio-pipeline.js';
import type { SpeakerUtterance, VoicePipelineConfig } from './types.js';
import { getContainer } from '../container.js';

const logger = createLogger('voice-connection');

// ── Managed connection state ────────────────────────────────────────

interface ManagedConnection {
  connection: VoiceConnection;
  guildId: string;
  channelId: string;
  speakerPipelines: Map<string, SpeakerPipeline>;
  utteranceHandler?: (u: SpeakerUtterance) => void;
}

/** Active voice connections keyed by guild ID. */
const connections = new Map<string, ManagedConnection>();

// ── Public API ──────────────────────────────────────────────────────

/** Get the active managed connection for a guild (if any). */
export function getActiveConnection(guildId: string): ManagedConnection | undefined {
  return connections.get(guildId);
}

/**
 * Join a voice channel and start listening for per-speaker audio.
 *
 * Tears down any existing connection for the guild before creating
 * a new one. Sets `selfDeaf: false` so we can receive audio.
 */
export async function joinAndListen(
  guildId: string,
  channelId: string,
  adapterCreator: DiscordGatewayAdapterCreator,
  opts?: {
    onUtterance?: (u: SpeakerUtterance) => void;
    pipelineConfig?: Partial<VoicePipelineConfig>;
  },
): Promise<VoiceConnection> {
  // Clean up existing connection
  const existing = connections.get(guildId);
  if (existing) {
    existing.connection.destroy();
    cleanupConnection(guildId);
  }

  const connection = joinVoiceChannel({
    channelId,
    guildId,
    adapterCreator,
    selfDeaf: false,
  });

  const managed: ManagedConnection = {
    connection,
    guildId,
    channelId,
    speakerPipelines: new Map(),
    utteranceHandler: opts?.onUtterance,
  };
  connections.set(guildId, managed);

  // Lifecycle handlers
  connection.on(VoiceConnectionStatus.Ready, () => {
    logger.info({ guildId, channelId }, 'Voice connection ready');
    setupReceive(managed, opts?.pipelineConfig);
  });

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    logger.warn({ guildId }, 'Voice connection disconnected');
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      logger.warn({ guildId }, 'Reconnect failed, destroying connection');
      connection.destroy();
    }
  });

  connection.on(VoiceConnectionStatus.Destroyed, () => {
    logger.info({ guildId }, 'Voice connection destroyed');
    cleanupConnection(guildId);
  });

  // Wait for ready
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  } catch {
    connection.destroy();
    cleanupConnection(guildId);
    throw new Error('Voice connection did not become ready within 20 seconds');
  }

  return connection;
}

/** Leave the voice channel for a guild. */
export function leaveVoice(guildId: string): void {
  const managed = connections.get(guildId);
  if (managed) {
    managed.connection.destroy();
    cleanupConnection(guildId);
  }
}

/** Register a global utterance handler for an already-connected guild. */
export function setUtteranceHandler(
  guildId: string,
  handler: (u: SpeakerUtterance) => void,
): void {
  const managed = connections.get(guildId);
  if (managed) {
    managed.utteranceHandler = handler;
  }
}

// ── Receive-stream setup ────────────────────────────────────────────

function setupReceive(
  managed: ManagedConnection,
  pipelineConfig?: Partial<VoicePipelineConfig>,
): void {
  const { connection, guildId, channelId } = managed;
  const receiver = connection.receiver;

  receiver.speaking.on('start', (userId: string) => {
    // Skip if already processing this speaker
    if (managed.speakerPipelines.has(userId)) return;

    // Skip self
    const container = getContainer();
    const botId = container.discord.user?.id;
    if (userId === botId) return;

    logger.debug({ guildId, userId }, 'Speaker started, creating pipeline');

    const opusStream = receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: 1000,
      },
    });

    // Resolve STT provider (best-effort — null if not configured)
    let sttProvider = null;
    try {
      sttProvider = container.providers.getStt();
    } catch {
      logger.debug({ guildId }, 'No STT provider available');
    }

    const pipeline = new SpeakerPipeline(
      userId,
      guildId,
      channelId,
      sttProvider,
      pipelineConfig,
    );

    pipeline.onUtterance((utterance) => {
      managed.utteranceHandler?.(utterance);
    });

    managed.speakerPipelines.set(userId, pipeline);

    opusStream.on('data', (packet: Buffer) => {
      pipeline.processOpusPacket(packet);
    });

    opusStream.on('end', () => {
      logger.debug({ guildId, userId }, 'Speaker stream ended');
      pipeline.flush();
      pipeline.destroy();
      managed.speakerPipelines.delete(userId);
    });

    opusStream.on('error', (err: Error) => {
      logger.error({ guildId, userId, err }, 'Speaker stream error');
      pipeline.destroy();
      managed.speakerPipelines.delete(userId);
    });
  });
}

// ── Cleanup ─────────────────────────────────────────────────────────

function cleanupConnection(guildId: string): void {
  const managed = connections.get(guildId);
  if (!managed) return;

  for (const pipeline of managed.speakerPipelines.values()) {
    pipeline.destroy();
  }
  managed.speakerPipelines.clear();
  connections.delete(guildId);
}
