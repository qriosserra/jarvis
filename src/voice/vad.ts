import type { VadSegment } from './types.js';

// ── Pluggable VAD interface ─────────────────────────────────────────

export interface VadOptions {
  /** Sample rate of incoming PCM (Hz). */
  sampleRate: number;
  /** RMS threshold (0–1 normalised) above which audio is considered speech. */
  speechThreshold?: number;
  /** Milliseconds of silence to wait before closing a speech segment. */
  silenceDuration?: number;
  /** Minimum segment duration (ms) to emit — shorter segments are discarded. */
  minSpeechDuration?: number;
}

export interface VadProcessor {
  /** Feed PCM Int16LE audio data. */
  write(pcm: Buffer): void;
  /** Flush any remaining buffered audio as a final segment. */
  flush(): void;
  /** Reset processor state. */
  reset(): void;
  /** Register a handler for completed speech segments. */
  onSegment(handler: (segment: VadSegment) => void): void;
}

// ── Energy-based VAD ────────────────────────────────────────────────

/**
 * Simple RMS-energy VAD that detects speech/silence transitions.
 *
 * When energy rises above `speechThreshold`, audio is accumulated.
 * When energy drops below threshold for `silenceDuration` ms, the
 * accumulated audio is emitted as a segment (if long enough).
 */
export class EnergyVad implements VadProcessor {
  private sampleRate: number;
  private speechThreshold: number;
  private silenceDurationMs: number;
  private minSpeechDurationMs: number;

  private isSpeaking = false;
  private speechStart = 0;
  private lastSpeechMs = 0;
  private chunks: Buffer[] = [];
  private totalMs = 0;
  private handler?: (segment: VadSegment) => void;

  constructor(opts: VadOptions) {
    this.sampleRate = opts.sampleRate;
    this.speechThreshold = opts.speechThreshold ?? 0.01;
    this.silenceDurationMs = opts.silenceDuration ?? 800;
    this.minSpeechDurationMs = opts.minSpeechDuration ?? 300;
  }

  onSegment(handler: (segment: VadSegment) => void): void {
    this.handler = handler;
  }

  write(pcm: Buffer): void {
    const rms = computeRms(pcm);
    const chunkMs = (pcm.length / 2 / this.sampleRate) * 1000;
    const now = Date.now();

    if (rms >= this.speechThreshold) {
      if (!this.isSpeaking) {
        this.isSpeaking = true;
        this.speechStart = now;
        this.chunks = [];
      }
      this.lastSpeechMs = now;
      this.chunks.push(pcm);
    } else if (this.isSpeaking) {
      // Still accumulate silence within the hang time
      this.chunks.push(pcm);

      if (now - this.lastSpeechMs >= this.silenceDurationMs) {
        this.emitSegment(now);
      }
    }

    this.totalMs += chunkMs;
  }

  flush(): void {
    if (this.isSpeaking && this.chunks.length > 0) {
      this.emitSegment(Date.now());
    }
  }

  reset(): void {
    this.isSpeaking = false;
    this.speechStart = 0;
    this.lastSpeechMs = 0;
    this.chunks = [];
    this.totalMs = 0;
  }

  private emitSegment(endMs: number): void {
    const duration = endMs - this.speechStart;
    if (duration >= this.minSpeechDurationMs && this.handler) {
      this.handler({
        audio: Buffer.concat(this.chunks),
        startMs: this.speechStart,
        endMs,
      });
    }
    this.isSpeaking = false;
    this.chunks = [];
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Compute normalised RMS (0–1) of Int16LE PCM data. */
function computeRms(pcm: Buffer): number {
  const samples = pcm.length / 2;
  if (samples === 0) return 0;

  let sum = 0;
  for (let i = 0; i < pcm.length; i += 2) {
    const sample = pcm.readInt16LE(i) / 32768;
    sum += sample * sample;
  }
  return Math.sqrt(sum / samples);
}
