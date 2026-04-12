import type { OperationLatency, OperationStatus } from '../db/types.js';
import type { OperationLatencyRepo, CreateOperationLatencyData } from '../db/repos.js';
import { createLogger } from './logger.js';

const logger = createLogger('latency-tracker');

// ── Operation context ────────────────────────────────────────────────

export interface OperationContext {
  correlationId?: string;
  guildId?: string;
  memberId?: string;
  membershipId?: string;
  interactionId?: string;
  parentOperationId?: string;
}

// ── Track options ────────────────────────────────────────────────────

export interface TrackOptions {
  /** Short, snake_case name identifying the operation (e.g. "llm_interpretation"). */
  operationName: string;
  /** Broad category: "pipeline", "llm", "embedding", "tts", "stt", "research", "queue", "db". */
  operationType: string;
  /** Provider name when the operation invokes a model-backed capability. */
  providerName?: string;
  /** Configured/requested model name. */
  model?: string;
  /** Contextual identifiers for correlation and attribution. */
  context?: OperationContext;
  /** Arbitrary metadata to store alongside the latency record. */
  metadata?: Record<string, unknown>;
  /**
   * Pre-assigned operation ID (UUID).  When set, the persisted record
   * uses this ID instead of a Postgres-generated one.  This allows
   * parent operations to share their ID with child operations before
   * the parent record is persisted (parent record is written after the
   * wrapped function completes).
   */
  operationId?: string;
}

// ── Result type ──────────────────────────────────────────────────────

export interface TrackedResult<T> {
  result: T;
  durationMs: number;
  operationId?: string;
}

// ── Repo accessor ────────────────────────────────────────────────────

let _repoAccessor: (() => OperationLatencyRepo | undefined) | undefined;

/**
 * Configure how the tracker obtains the repo instance.
 * Called once at startup with a lazy accessor to avoid circular imports.
 */
export function setLatencyRepoAccessor(accessor: () => OperationLatencyRepo | undefined): void {
  _repoAccessor = accessor;
}

function getRepo(): OperationLatencyRepo | undefined {
  return _repoAccessor?.();
}

// ── Core tracker ─────────────────────────────────────────────────────

/**
 * Execute an async operation and record its latency.
 *
 * - Emits a structured log with duration and status on completion.
 * - Persists a row in `operation_latencies` (best-effort).
 * - Returns the wrapped result plus timing metadata.
 *
 * Persistence failures are swallowed — observability must never
 * break user-facing flows.
 */
export async function trackOperation<T>(
  opts: TrackOptions,
  fn: () => Promise<T>,
): Promise<TrackedResult<T>> {
  const startedAt = new Date();
  const startMs = performance.now();
  let status: OperationStatus = 'completed';

  // Two-phase: if caller pre-assigned an operationId, insert a 'running'
  // placeholder row *before* executing fn() so child operations can safely
  // reference this ID via their parentOperationId FK.
  const twoPhase = !!opts.operationId;
  if (twoPhase) {
    await insertRunningRow(opts, startedAt);
  }

  try {
    const result = await fn();
    const durationMs = Math.round(performance.now() - startMs);

    let operationId: string | undefined;
    if (twoPhase) {
      await finalizeRow(opts.operationId!, status, durationMs, opts);
      operationId = opts.operationId;
    } else {
      operationId = await persistRecord(opts, status, durationMs, startedAt) ?? opts.operationId;
    }

    logCompletion(opts, status, durationMs);

    return { result, durationMs, operationId };
  } catch (err) {
    status = 'failed';
    const durationMs = Math.round(performance.now() - startMs);

    if (twoPhase) {
      await finalizeRow(opts.operationId!, status, durationMs, opts);
    } else {
      await persistRecord(opts, status, durationMs, startedAt);
    }

    logCompletion(opts, status, durationMs, err);

    throw err;
  }
}

// ── Internal helpers ─────────────────────────────────────────────────

/**
 * Insert a 'running' placeholder row for two-phase operations.
 * The row has no duration yet — it will be finalized after fn() completes.
 */
async function insertRunningRow(
  opts: TrackOptions,
  startedAt: Date,
): Promise<void> {
  const repo = getRepo();
  if (!repo) return;

  try {
    await repo.create({
      id: opts.operationId,
      operationName: opts.operationName,
      operationType: opts.operationType,
      providerName: opts.providerName ?? null,
      model: opts.model ?? null,
      status: 'running',
      durationMs: null,
      startedAt,
      correlationId: opts.context?.correlationId ?? null,
      guildId: opts.context?.guildId ?? null,
      memberId: opts.context?.memberId ?? null,
      membershipId: opts.context?.membershipId ?? null,
      interactionId: opts.context?.interactionId ?? null,
      parentOperationId: opts.context?.parentOperationId ?? null,
      metadata: opts.metadata ?? {},
    });
  } catch (err) {
    logger.debug(
      { operationName: opts.operationName, err },
      'Failed to insert running latency row (best-effort)',
    );
  }
}

/**
 * Finalize a previously inserted 'running' row with final status and duration.
 */
async function finalizeRow(
  id: string,
  status: OperationStatus,
  durationMs: number,
  opts: TrackOptions,
): Promise<void> {
  const repo = getRepo();
  if (!repo) return;

  try {
    await repo.finalize(id, status, durationMs, {
      providerName: opts.providerName,
      model: opts.model,
      metadata: opts.metadata,
    });
  } catch (err) {
    logger.debug(
      { operationName: opts.operationName, err },
      'Failed to finalize latency row (best-effort)',
    );
  }
}

/**
 * Single-phase persist for operations without a pre-assigned ID.
 */
async function persistRecord(
  opts: TrackOptions,
  status: OperationStatus,
  durationMs: number,
  startedAt: Date,
): Promise<string | undefined> {
  const repo = getRepo();
  if (!repo) return undefined;

  try {
    const data: CreateOperationLatencyData = {
      ...(opts.operationId ? { id: opts.operationId } : {}),
      operationName: opts.operationName,
      operationType: opts.operationType,
      providerName: opts.providerName ?? null,
      model: opts.model ?? null,
      status,
      durationMs,
      startedAt,
      correlationId: opts.context?.correlationId ?? null,
      guildId: opts.context?.guildId ?? null,
      memberId: opts.context?.memberId ?? null,
      membershipId: opts.context?.membershipId ?? null,
      interactionId: opts.context?.interactionId ?? null,
      parentOperationId: opts.context?.parentOperationId ?? null,
      metadata: opts.metadata ?? {},
    };

    const record = await repo.create(data);
    return record.id;
  } catch (err) {
    logger.debug(
      { operationName: opts.operationName, err },
      'Failed to persist operation latency record (best-effort)',
    );
    return undefined;
  }
}

function logCompletion(
  opts: TrackOptions,
  status: OperationStatus,
  durationMs: number,
  error?: unknown,
): void {
  const logData: Record<string, unknown> = {
    op: opts.operationName,
    type: opts.operationType,
    status,
    durationMs,
  };

  if (opts.providerName) logData.provider = opts.providerName;
  if (opts.model) logData.model = opts.model;
  if (opts.context?.correlationId) logData.correlationId = opts.context.correlationId;

  if (status === 'failed') {
    logData.err = error;
    logger.warn(logData, `Operation ${opts.operationName} failed (${durationMs}ms)`);
  } else {
    logger.info(logData, `Operation ${opts.operationName} completed (${durationMs}ms)`);
  }
}
