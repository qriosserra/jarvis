// ── LLM Provider ──────────────────────────────────────────────────────

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmResponse {
  content: string;
  model: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  /** Server-side processing time reported by the provider (ms), if available. */
  providerDurationMs?: number;
}

export interface LlmProvider {
  readonly name: string;

  /** Generate a completion from a message history. */
  complete(messages: LlmMessage[], opts?: { model?: string; temperature?: number; maxTokens?: number }): Promise<LlmResponse>;
}

// ── STT Provider ──────────────────────────────────────────────────────

export interface SttTranscriptEvent {
  /** The transcribed text. */
  text: string;
  /** Whether this is a final (non-interim) transcript. */
  isFinal: boolean;
  /** Detected or hinted language code (e.g. "en", "nl"). */
  language?: string;
  /** Confidence score 0–1 if available. */
  confidence?: number;
}

export interface SttStream {
  /** Write PCM audio data into the stream. */
  write(pcm: Buffer): void;
  /** Signal end of audio. */
  end(): void;
  /** Register handler for transcript events. */
  onTranscript(handler: (event: SttTranscriptEvent) => void): void;
  /** Register handler for errors. */
  onError(handler: (err: Error) => void): void;
  /** Register handler for stream close. */
  onClose(handler: () => void): void;
}

export interface SttProvider {
  readonly name: string;

  /** Open a new streaming transcription session. */
  createStream(opts?: { language?: string; sampleRate?: number }): SttStream;
}

// ── TTS Provider ──────────────────────────────────────────────────────

export interface TtsResult {
  /** Raw audio buffer (format determined by provider, typically PCM or Opus). */
  audio: Buffer;
  /** Audio format identifier (e.g. "pcm_16000", "opus"). */
  format: string;
  /** Sample rate in Hz. */
  sampleRate: number;
}

export interface TtsProvider {
  readonly name: string;

  /** Synthesize text into audio. */
  synthesize(text: string, opts?: { voice?: string; language?: string }): Promise<TtsResult>;
}

// ── Research Provider ─────────────────────────────────────────────────

export interface ResearchResult {
  title: string;
  url: string;
  snippet: string;
  content?: string;
}

export interface ResearchProvider {
  readonly name: string;

  /** Search the web for relevant results. */
  search(query: string, opts?: { maxResults?: number }): Promise<ResearchResult[]>;

  /** Retrieve full page content from a URL. */
  getPageContent(url: string): Promise<string>;
}

// ── Embedding Provider ────────────────────────────────────────────────

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  /** Server-side processing time reported by the provider (ms), if available. */
  providerDurationMs?: number;
}

export interface EmbeddingProvider {
  readonly name: string;

  /** Generate an embedding vector for the given text. */
  embed(text: string, opts?: { model?: string; inputType?: 'query' | 'document' }): Promise<EmbeddingResult>;

  /** Generate embeddings for multiple texts in a single call. */
  embedBatch(texts: string[], opts?: { model?: string; inputType?: 'query' | 'document' }): Promise<EmbeddingResult[]>;
}
