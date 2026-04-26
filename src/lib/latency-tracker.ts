import { createLogger } from './logger.js';

const logger = createLogger('latency-tracker');

// ── Operation context ────────────────────────────────────────────────

export interface OperationContext {
  correlationId?: string;
  guildId?: string;
  memberId?: string;
  interactionId?: string;
}

// ── Track options ────────────────────────────────────────────────────

export interface TrackOptions {
  /** Short, snake_case name identifying the operation (e.g. "llm_interpretation"). */
  operationName: string;
  /** Broad category: "pipeline", "llm", "embedding", "tts", "stt", "research", "queue", "db". */
  operationType: string;
  /** Provider name when the operation invokes a model-backed capability. */
  providerName?: string | null;
  /** Configured/requested model name. */
  model?: string | null;
  /** Contextual identifiers for correlation and attribution. */
  context?: OperationContext;
  /** Processing time reported by the external API provider (excludes network overhead). */
  providerDurationMs?: number | null;
  /** Number of tokens in the request sent to the provider. */
  inputTokens?: number | null;
  /** Number of tokens in the response received from the provider. */
  outputTokens?: number | null;
  /** Arbitrary metadata to store alongside the latency record. */
  metadata?: Record<string, unknown>;
}

// ── Result type ──────────────────────────────────────────────────────

export interface TrackedResult<T> {
  result: T;
  durationMs: number;
}

// ── Core tracker ─────────────────────────────────────────────────────

type OperationStatus = 'completed' | 'failed';

/**
 * Execute an async operation and record its latency.
 *
 * Emits a structured `logger.debug(...)` at completion/failure so the
 * Pino DB transport can persist a row in the `log` table automatically.
 * Returns the wrapped result plus timing metadata.
 */
export async function trackOperation<T>(
  opts: TrackOptions,
  fn: () => Promise<T>,
  enrich?: (result: T) => { providerDurationMs?: number | null; inputTokens?: number | null; outputTokens?: number | null },
): Promise<TrackedResult<T>> {
  const startMs = performance.now();
  let status: OperationStatus = 'completed';

  try {
    const result = await fn();
    const durationMs = Math.round(performance.now() - startMs);

    const enrichment = enrich?.(result);
    const effectiveOpts: TrackOptions = enrichment !== undefined ? { ...opts, ...enrichment } : opts;

    emitOperationLog(effectiveOpts, status, durationMs);

    return { result, durationMs };
  } catch (err) {
    status = 'failed';
    const durationMs = Math.round(performance.now() - startMs);

    emitOperationLog(opts, status, durationMs);

    throw err;
  }
}

// ── Pipeline runner ──────────────────────────────────────────────────

export interface PipelineRunOptions {
  /** Broad category shared by every step (e.g. "pipeline"). */
  operationType: string;
  /** Contextual identifiers shared by every step. */
  context?: OperationContext;
}

/**
 * Execute a sequence of tracked operations that share the same
 * `operationType` and `context`.  Each step is awaited in declaration
 * order; the first failure re-throws immediately and skips remaining
 * steps.
 *
 * Returns the collected results as an ordered array.
 */
export async function runTrackedPipeline(
  opts: PipelineRunOptions,
  steps: ReadonlyArray<[operationName: string, fn: () => Promise<unknown>]>,
): Promise<unknown[]> {
  const results: unknown[] = [];
  for (const [operationName, fn] of steps) {
    const { result } = await trackOperation(
      { operationName, operationType: opts.operationType, context: opts.context },
      fn,
    );
    results.push(result);
  }
  return results;
}

// ── Internal helpers ─────────────────────────────────────────────────

/**
 * Emit a structured log entry that the Pino DB transport can capture.
 * Uses `logger.debug` so console/file output stays quiet at `info` level
 * while the DB transport still receives the data.
 */
function emitOperationLog(
  opts: TrackOptions,
  status: OperationStatus,
  durationMs: number,
): void {
  logger.debug(
    {
      status,
      durationMs,
      correlationId: opts.context?.correlationId,
      guildId: opts.context?.guildId,
      memberId: opts.context?.memberId,
      interactionId: opts.context?.interactionId,
      metadata: {
        operationName: opts.operationName,
        operationType: opts.operationType,
        providerName: opts.providerName ?? undefined,
        model: opts.model ?? undefined,
        providerDurationMs: opts.providerDurationMs ?? undefined,
        inputTokens: opts.inputTokens ?? undefined,
        outputTokens: opts.outputTokens ?? undefined,
        ...opts.metadata,
      },
    },
    `${opts.operationName} ${status}`,
  );
}

// ── Formatting utilities ────────────────────────────────────────────

/**
 * Produce a human-readable duration string.
 *
 * When provider-reported server-side time is available, it is appended
 * in parentheses so readers can see network overhead at a glance.
 *
 * Examples: `"500ms"`, `"500ms (300ms server-side)"`
 */
export function formatDuration(
  totalMs: number,
  providerMs?: number | null,
): string {
  if (typeof providerMs === 'number') {
    return `${totalMs}ms (${providerMs}ms server-side)`;
  }
  return `${totalMs}ms`;
}

/**
 * Produce a human-readable content-length summary.
 *
 * For LLM calls the prompt and response character counts are shown;
 * for embeddings only the input content length is relevant.
 *
 * Examples:
 *  - `"2000 input • 120 output"`
 *  - `"450 input"`
 */
export function formatLength(
  promptChars: number,
  responseChars?: number,
): string {
  if (typeof responseChars === 'number') {
    return `${promptChars} input • ${responseChars} output`;
  }
  return `${promptChars} input`;
}

/**
 * Produce a compact token-usage summary string.
 *
 * Accepts either the full input/output pair (LLM calls) or just the
 * input count (embedding calls, which have no output tokens).
 * Returns `undefined` when no token information is available so callers
 * can omit the field from structured log data.
 */
export function formatTokens(
  inputTokens?: number | null,
  outputTokens?: number | null,
): string | undefined {
  const hasInput = typeof inputTokens === 'number';
  const hasOutput = typeof outputTokens === 'number';

  if (!hasInput && !hasOutput) return undefined;

  if (hasInput && hasOutput) {
    return `${inputTokens} input • ${outputTokens} output`;
  }

  if (hasInput) {
    return `${inputTokens} input`;
  }

  return `${outputTokens} output`;
}
