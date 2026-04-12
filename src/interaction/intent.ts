/**
 * Typed intent outcomes produced by the interpretation stage.
 *
 * Each variant is a discriminated union member keyed on `kind`.
 * Deterministic guild actions carry unresolved human-readable references
 * (e.g. member name, channel name) that the action executor resolves
 * against Discord state before execution.
 */

// ── Canonical intent-kind enum ─────────────────────────────────────────

/**
 * Single source of truth for every intent kind recognised by Jarvis.
 *
 * String values **must** stay stable — they appear in LLM JSON schemas,
 * persisted records, metrics labels, and prompt examples.
 */
export enum IntentKind {
  Respond = 'respond',
  AskClarification = 'ask-clarification',
  ResearchAndRespond = 'research-and-respond',
  JoinVoice = 'join-voice',
  MoveMember = 'move-member',
  MuteMember = 'mute-member',
  DeafenMember = 'deafen-member',
  RenameMember = 'rename-member',
  SendTextMessage = 'send-text-message',
}

// ── Conversational outcomes ────────────────────────────────────────────

/** Generate a natural-language reply (text or spoken). */
export interface RespondIntent {
  kind: IntentKind.Respond;
  /** Optional hint the interpreter can pass to the response generator. */
  responseHint?: string;
}

/** Ask the requester a clarifying question before proceeding. */
export interface AskClarificationIntent {
  kind: IntentKind.AskClarification;
  /** The clarifying question to present to the requester. */
  question: string;
}

/** Answer a request using web research before responding. */
export interface ResearchAndRespondIntent {
  kind: IntentKind.ResearchAndRespond;
  /** Search query or topic derived from the user request. */
  query: string;
}

// ── Deterministic guild-action outcomes ────────────────────────────────

/** Join a voice channel. */
export interface JoinVoiceIntent {
  kind: IntentKind.JoinVoice;
  /** Human-readable or ID reference to the target voice channel. */
  channelRef: string;
}

/** Move a guild member to a different voice channel. */
export interface MoveMemberIntent {
  kind: IntentKind.MoveMember;
  /** Human-readable or ID reference to the target member. */
  targetRef: string;
  /** Human-readable or ID reference to the destination voice channel. */
  destinationRef: string;
}

/** Mute or unmute a guild member in voice. */
export interface MuteMemberIntent {
  kind: IntentKind.MuteMember;
  /** Human-readable or ID reference to the target member. */
  targetRef: string;
  /** `true` to server-mute, `false` to unmute. */
  mute: boolean;
}

/** Deafen or undeafen a guild member in voice. */
export interface DeafenMemberIntent {
  kind: IntentKind.DeafenMember;
  /** Human-readable or ID reference to the target member. */
  targetRef: string;
  /** `true` to server-deafen, `false` to undeafen. */
  deafen: boolean;
}

/** Rename (change server nickname of) a guild member. */
export interface RenameMemberIntent {
  kind: IntentKind.RenameMember;
  /** Human-readable or ID reference to the target member. */
  targetRef: string;
  /** The new nickname to apply. */
  newName: string;
}

/** Send a text message to a guild text channel. */
export interface SendTextMessageIntent {
  kind: IntentKind.SendTextMessage;
  /** Human-readable or ID reference to the destination text channel.
   *  When omitted the executor uses the guild's default general channel. */
  channelRef?: string;
  /** The message body to send. */
  message: string;
}

// ── Union ──────────────────────────────────────────────────────────────

export type IntentOutcome =
  | RespondIntent
  | AskClarificationIntent
  | ResearchAndRespondIntent
  | JoinVoiceIntent
  | MoveMemberIntent
  | MuteMemberIntent
  | DeafenMemberIntent
  | RenameMemberIntent
  | SendTextMessageIntent;

// ── Derived intent-kind collections ────────────────────────────────────

/** The set of intent kinds that map to deterministic guild actions. */
export const DETERMINISTIC_INTENT_KINDS = new Set<IntentKind>([
  IntentKind.JoinVoice,
  IntentKind.MoveMember,
  IntentKind.MuteMember,
  IntentKind.DeafenMember,
  IntentKind.RenameMember,
  IntentKind.SendTextMessage,
]);

/** Deterministic intent kinds that carry a `targetRef` for a guild member. */
export const MEMBER_REFERENCING_INTENT_KINDS = new Set<IntentKind>([
  IntentKind.MoveMember,
  IntentKind.MuteMember,
  IntentKind.DeafenMember,
  IntentKind.RenameMember,
]);

/** Every recognised intent kind as an array (useful for validation sets and prompts). */
export const ALL_INTENT_KINDS: readonly IntentKind[] = Object.values(IntentKind);

/** Type guard — returns `true` when the intent should be routed to the deterministic action executor. */
export function isDeterministicIntent(intent: IntentOutcome): boolean {
  return DETERMINISTIC_INTENT_KINDS.has(intent.kind);
}
