import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('jarvis', '0.1.0');

// ── Request classification ───────────────────────────────────────────

/** Counter for interactions processed, labeled by surface + trigger + intent kind. */
export const interactionCounter = meter.createCounter('jarvis.interactions.total', {
  description: 'Total interactions processed',
});

/** Histogram for end-to-end interaction duration (ms). */
export const interactionDuration = meter.createHistogram('jarvis.interactions.duration_ms', {
  description: 'Interaction processing duration in milliseconds',
  unit: 'ms',
});

/** Counter for intent classification outcomes. */
export const intentClassificationCounter = meter.createCounter('jarvis.intent.classification.total', {
  description: 'Intent classifications by kind',
});

// ── Provider latency ─────────────────────────────────────────────────

/** Histogram for LLM provider call duration (ms). */
export const llmLatency = meter.createHistogram('jarvis.provider.llm.duration_ms', {
  description: 'LLM provider call duration in milliseconds',
  unit: 'ms',
});

/** Histogram for TTS provider synthesis duration (ms). */
export const ttsLatency = meter.createHistogram('jarvis.provider.tts.duration_ms', {
  description: 'TTS synthesis duration in milliseconds',
  unit: 'ms',
});

/** Histogram for research provider search duration (ms). */
export const researchLatency = meter.createHistogram('jarvis.provider.research.duration_ms', {
  description: 'Research provider search duration in milliseconds',
  unit: 'ms',
});

/** Counter for provider errors by provider type and name. */
export const providerErrorCounter = meter.createCounter('jarvis.provider.errors.total', {
  description: 'Provider errors by type and name',
});

// ── Voice acknowledgement latency ────────────────────────────────────

/** Histogram for voice acknowledgement end-to-end latency (ms from speech end to audio start). */
export const voiceAckLatency = meter.createHistogram('jarvis.voice.ack.duration_ms', {
  description: 'Voice acknowledgement latency from speech end to audio start',
  unit: 'ms',
});

/** Histogram for full voice response end-to-end latency (ms). */
export const voiceResponseLatency = meter.createHistogram('jarvis.voice.response.duration_ms', {
  description: 'Full voice response latency from speech end to audio end',
  unit: 'ms',
});

/** Counter for voice interactions that required an ack before full response. */
export const voiceAckUsedCounter = meter.createCounter('jarvis.voice.ack.used.total', {
  description: 'Voice interactions that used an acknowledgement before full response',
});

// ── Queue health ─────────────────────────────────────────────────────

/** Counter for queue jobs processed by queue name and status (completed/failed). */
export const queueJobCounter = meter.createCounter('jarvis.queue.jobs.total', {
  description: 'Queue jobs processed by name and status',
});

/** Histogram for queue job processing duration (ms). */
export const queueJobDuration = meter.createHistogram('jarvis.queue.jobs.duration_ms', {
  description: 'Queue job processing duration in milliseconds',
  unit: 'ms',
});

// ── Action outcomes ──────────────────────────────────────────────────

/** Counter for deterministic action outcomes by kind and success/failure. */
export const actionOutcomeCounter = meter.createCounter('jarvis.actions.outcome.total', {
  description: 'Deterministic action outcomes by kind and success status',
});

// ── Memory ───────────────────────────────────────────────────────────

/** Counter for memory operations (persist, retrieve, extract). */
export const memoryOpCounter = meter.createCounter('jarvis.memory.ops.total', {
  description: 'Memory operations by type',
});
