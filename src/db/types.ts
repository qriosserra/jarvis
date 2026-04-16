/** Surface through which a request was received. */
export type Surface = 'text' | 'voice';

/** Category of a persisted memory record. */
export type MemoryCategory = 'summary' | 'fact' | 'preference' | 'action_outcome';

/** Source that produced an identity alias. */
export type AliasSource = 'discord' | 'explicit' | 'inferred';

/** Kind of identity alias stored for a member. */
export type AliasType = 'username' | 'nickname' | 'preferred_name' | 'first_name';

// ── Entities ──────────────────────────────────────────────────────────

export interface User {
  id: string;
  username: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface GuildMembership {
  id: string;
  guildId: string;
  userId: string;
  displayName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Guild {
  id: string;
  name: string;
  joinedAt: Date;
  settings: Record<string, unknown>;
  updatedAt: Date;
}

export interface Member {
  id: string;
  guildId: string;
  username: string;
  displayName: string | null;
  joinedAt: Date;
  updatedAt: Date;
}

export interface Persona {
  id: string;
  name: string;
  description: string | null;
  systemPrompt: string;
  responseStyle: Record<string, unknown>;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Interaction {
  id: string;
  guildId: string;
  memberId: string;
  membershipId: string | null;
  channelId: string;
  surface: Surface;
  requestText: string;
  responseText: string | null;
  personaId: string | null;
  language: string | null;
  correlationId: string | null;
  createdAt: Date;
}

export interface MemoryRecord {
  id: string;
  guildId: string;
  memberId: string | null;
  membershipId: string | null;
  category: MemoryCategory;
  content: string;
  capability: string | null;
  confidence: number;
  sourceInteractionId: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IdentityAlias {
  id: string;
  memberId: string;
  membershipId: string | null;
  guildId: string | null;
  aliasType: AliasType;
  value: string;
  source: AliasSource;
  confidence: number;
  confirmed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ActionOutcome {
  id: string;
  interactionId: string;
  guildId: string;
  actionType: string;
  targetMemberId: string | null;
  targetMembershipId: string | null;
  targetChannelId: string | null;
  success: boolean;
  errorMessage: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface Embedding {
  id: string;
  memoryRecordId: string;
  embedding: number[] | null;
  model: string;
  createdAt: Date;
}

/** Status of a tracked operation. */
export type OperationStatus = 'running' | 'completed' | 'failed';

export interface OperationLog {
  id: string;
  interactionId: string | null;
  correlationId: string | null;
  guildId: string | null;
  memberId: string | null;
  membershipId: string | null;
  operationName: string;
  operationType: string;
  parentOperationId: string | null;
  providerName: string | null;
  model: string | null;
  status: OperationStatus;
  durationMs: number | null;
  providerDurationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  startedAt: Date;
  metadata: Record<string, unknown>;
  createdAt: Date;
}
