/** Audio segment detected by VAD. */
export interface VadSegment {
  /** Concatenated PCM audio data for the speech segment. */
  audio: Buffer;
  /** When the speech started (ms since epoch). */
  startMs: number;
  /** When the speech ended (ms since epoch). */
  endMs: number;
}

/** A complete utterance from a speaker with transcript. */
export interface SpeakerUtterance {
  /** Discord user ID of the speaker. */
  userId: string;
  /** Guild ID where the speech was detected. */
  guildId: string;
  /** Voice channel ID where the speech was detected. */
  channelId: string;
  /** Transcribed text from STT. */
  transcript: string;
  /** Detected language code (e.g. "en"). */
  language?: string;
  /** STT confidence score 0–1. */
  confidence?: number;
  /** Timestamp when speech ended (ms since epoch). */
  speechEndMs: number;
}

/** Configuration for the voice pipeline. */
export interface VoicePipelineConfig {
  /** Target sample rate for STT provider (Hz). */
  sttSampleRate: number;
  /** RMS threshold (0–1 scale) for speech detection. */
  vadSpeechThreshold: number;
  /** Milliseconds of silence before ending a speech segment. */
  vadSilenceDuration: number;
  /** Minimum duration (ms) for a valid speech segment. */
  vadMinSpeechDuration: number;
  /** Max milliseconds before sending an acknowledgement for slow responses. */
  ackTimeoutMs: number;
}

export const DEFAULT_VOICE_CONFIG: VoicePipelineConfig = {
  sttSampleRate: 16000,
  vadSpeechThreshold: 0.01,
  vadSilenceDuration: 800,
  vadMinSpeechDuration: 300,
  ackTimeoutMs: 2000,
};
