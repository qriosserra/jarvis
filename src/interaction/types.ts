import type { Message } from 'discord.js';
import type { Surface } from '../db/types.js';

/** How a request was detected. */
export type RequestTrigger = 'mention' | 'reply' | 'indirect' | 'voice-addressed';

/** Minimal requester identity carried through the interaction pipeline. */
export interface Requester {
  /** Discord user ID. */
  id: string;
  /** Discord username. */
  username: string;
  /** Guild display name (nickname or global display name). */
  displayName: string | null;
}

/**
 * Shared context for a single Jarvis interaction, normalised from either
 * a guild text message or a voice utterance.
 */
export interface InteractionContext {
  /** Unique correlation ID for tracing. */
  correlationId: string;
  /** Database UUID of the persisted interaction row (set early in orchestrator). */
  interactionId?: string;
  /** Guild membership UUID — set during membership bootstrap. */
  membershipId?: string;
  /** Guild ID the request originated in. */
  guildId: string;
  /** Guild name — used to bootstrap the guild row before persistence. */
  guildName: string;
  /** Channel ID the request originated in. */
  channelId: string;
  /** Surface that produced this interaction. */
  surface: Surface;
  /** Guild member who made the request. */
  requester: Requester;
  /** Normalised request text (mention stripped for text, transcript for voice). */
  requestText: string;
  /** Detected or hinted language code (e.g. "en", "nl"). */
  language?: string;
  /** Persona name/selector — used for prompt loading via findByName. */
  personaId?: string;
  /** Resolved persona DB UUID — set by the orchestrator for persistence. */
  resolvedPersonaDbId?: string;
  /** How the request was detected. */
  trigger: RequestTrigger;
  /** Original Discord message — present only for text-surface interactions. */
  sourceMessage?: Message;
  /** Interaction creation timestamp. */
  timestamp: Date;

  // ── CLI / headless mode ───────────────────────────────────────────
  /**
   * When set, text replies are delivered through this callback instead
   * of Discord message APIs.  Used by the CLI runner and tests.
   */
  replyHandler?: (text: string) => void | Promise<void>;
  /**
   * When `true`, deterministic guild actions return simulated "would-do"
   * results instead of calling live Discord APIs.
   */
  simulateActions?: boolean;
  /**
   * Collects background work (e.g. memory persistence) so the caller
   * can `await Promise.allSettled(backgroundTasks)` before shutdown.
   * When undefined, background work is fire-and-forget.
   */
  backgroundTasks?: Promise<void>[];
  /**
   * When `true`, memory persistence is skipped entirely (e.g. `--no-memory`).
   */
  skipMemoryPersistence?: boolean;
}
