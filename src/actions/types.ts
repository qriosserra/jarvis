/** Result returned by every deterministic action handler. */
export interface ActionResult {
  /** Whether the Discord action succeeded. */
  success: boolean;
  /** User-facing message describing outcome or failure reason. */
  message: string;
  /** Resolved Discord member ID (when the action targets a member). */
  targetMemberId?: string;
  /** Resolved Discord channel ID (when the action targets a channel). */
  targetChannelId?: string;
}

/** Discriminated resolution outcome for guild entities. */
export type ResolveResult<T> =
  | { status: 'found'; value: T }
  | { status: 'ambiguous'; matches: T[]; label: string }
  | { status: 'not-found'; label: string };
