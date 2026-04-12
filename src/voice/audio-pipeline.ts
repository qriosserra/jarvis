import OpusScript from 'opusscript';
import type { SttProvider, SttStream } from '../providers/types.js';
import type { SpeakerUtterance, VadSegment, VoicePipelineConfig } from './types.js';
import { DEFAULT_VOICE_CONFIG } from './types.js';
import { EnergyVad } from './vad.js';
import type { VadProcessor } from './vad.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('audio-pipeline');

const OPUS_SAMPLE_RATE = 48000;
const OPUS_CHANNELS = 1;
const OPUS_FRAME_SIZE = 960; // 20ms at 48kHz

/**
 * Per-speaker audio pipeline that processes Discord voice receive
 * through Opus decode → PCM downsample → VAD → STT.
 *
 * Each instance tracks one speaker in one voice channel.
 */
export class SpeakerPipeline {
  private opus: OpusScript;
  private vad: VadProcessor;
  private sttProvider: SttProvider | null;
  private config: VoicePipelineConfig;
  private destroyed = false;
  private utteranceHandler?: (u: SpeakerUtterance) => void;

  constructor(
    private userId: string,
    private guildId: string,
    private channelId: string,
    sttProvider: SttProvider | null,
    config?: Partial<VoicePipelineConfig>,
  ) {
    this.config = { ...DEFAULT_VOICE_CONFIG, ...config };
    this.sttProvider = sttProvider;

    this.opus = new OpusScript(
      OPUS_SAMPLE_RATE,
      OPUS_CHANNELS,
      OpusScript.Application.VOIP,
    );

    this.vad = new EnergyVad({
      sampleRate: this.config.sttSampleRate,
      speechThreshold: this.config.vadSpeechThreshold,
      silenceDuration: this.config.vadSilenceDuration,
      minSpeechDuration: this.config.vadMinSpeechDuration,
    });

    this.vad.onSegment((segment) => this.handleVadSegment(segment));
  }

  /** Register a callback for completed utterances. */
  onUtterance(handler: (u: SpeakerUtterance) => void): void {
    this.utteranceHandler = handler;
  }

  /** Process a single Opus packet from the Discord receive stream. */
  processOpusPacket(packet: Buffer): void {
    if (this.destroyed) return;

    try {
      const pcm48k = this.opus.decode(packet);
      const pcm16k = downsample(Buffer.from(pcm48k), OPUS_SAMPLE_RATE, this.config.sttSampleRate);
      this.vad.write(pcm16k);
    } catch (err) {
      logger.debug({ userId: this.userId, err }, 'Failed to decode Opus packet, skipping');
    }
  }

  /** Flush remaining audio through the VAD. */
  flush(): void {
    this.vad.flush();
  }

  /** Tear down the pipeline and release resources. */
  destroy(): void {
    this.destroyed = true;
    try {
      this.opus.delete();
    } catch {
      // Ignore cleanup errors
    }
    this.vad.reset();
  }

  // ── VAD → STT ──────────────────────────────────────────────────────

  private handleVadSegment(segment: VadSegment): void {
    if (!this.sttProvider) {
      logger.warn({ userId: this.userId }, 'No STT provider configured, discarding speech segment');
      return;
    }

    const sttStream = this.sttProvider.createStream({
      sampleRate: this.config.sttSampleRate,
    });

    let finalTranscript = '';
    let detectedLanguage: string | undefined;
    let bestConfidence: number | undefined;

    sttStream.onTranscript((event) => {
      if (event.isFinal && event.text.trim()) {
        finalTranscript += (finalTranscript ? ' ' : '') + event.text.trim();
        detectedLanguage = event.language ?? detectedLanguage;
        bestConfidence =
          event.confidence !== undefined
            ? Math.max(bestConfidence ?? 0, event.confidence)
            : bestConfidence;
      }
    });

    sttStream.onError((err) => {
      logger.error({ userId: this.userId, guildId: this.guildId, err }, 'STT stream error');
    });

    sttStream.onClose(() => {
      if (finalTranscript && this.utteranceHandler) {
        this.utteranceHandler({
          userId: this.userId,
          guildId: this.guildId,
          channelId: this.channelId,
          transcript: finalTranscript,
          language: detectedLanguage,
          confidence: bestConfidence,
          speechEndMs: segment.endMs,
        });
      }
    });

    // Feed the segment audio into STT and close
    sttStream.write(segment.audio);
    sttStream.end();
  }
}

// ── Audio helpers ───────────────────────────────────────────────────

/**
 * Downsample Int16LE PCM from `srcRate` to `dstRate` using simple decimation.
 * Only supports integer ratio downsampling (e.g. 48000 → 16000 = ratio 3).
 */
function downsample(pcm: Buffer, srcRate: number, dstRate: number): Buffer {
  if (srcRate === dstRate) return pcm;

  const ratio = srcRate / dstRate;
  if (!Number.isInteger(ratio) || ratio < 1) {
    throw new Error(`Unsupported downsample ratio: ${srcRate} → ${dstRate}`);
  }

  const srcSamples = pcm.length / 2;
  const dstSamples = Math.floor(srcSamples / ratio);
  const out = Buffer.allocUnsafe(dstSamples * 2);

  for (let i = 0; i < dstSamples; i++) {
    out.writeInt16LE(pcm.readInt16LE(i * ratio * 2), i * 2);
  }

  return out;
}
