-- schema.sql: Consolidated Jarvis v1 schema (source of truth for dev bootstrapping)
--
-- This file represents the final effective schema produced by migrations 001–006.
-- When present, the migration runner applies it in a single transaction and records
-- a 'schema.sql' marker in _migration. Numbered migrations in src/db/migrations/
-- are preserved for reference and as a fallback if this file is absent.
--
-- Convention: all relation names are singular.

-- ── Extensions ──────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Migration tracking ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS _migration (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Guild ───────────────────────────────────────────────────────────
CREATE TABLE guild (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  settings JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Legacy member (guild-scoped, kept for backward compat) ──────────
CREATE TABLE member (
  id TEXT NOT NULL,
  guild_id TEXT NOT NULL REFERENCES guild(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  display_name TEXT,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, guild_id)
);

-- ── User (global Discord identity) ──────────────────────────────────
CREATE TABLE "user" (
  id TEXT PRIMARY KEY,           -- Discord user id
  username TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Guild membership (normalized guild-scoped identity) ─────────────
CREATE TABLE guild_membership (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id TEXT NOT NULL REFERENCES guild(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (guild_id, user_id)
);

-- ── Persona ─────────────────────────────────────────────────────────
CREATE TABLE persona (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  system_prompt TEXT NOT NULL,
  response_style JSONB NOT NULL DEFAULT '{}',
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Interaction ─────────────────────────────────────────────────────
CREATE TABLE interaction (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id TEXT NOT NULL REFERENCES guild(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  surface TEXT NOT NULL CHECK (surface IN ('text', 'voice')),
  request_text TEXT NOT NULL,
  response_text TEXT,
  persona_id TEXT REFERENCES persona(id) ON DELETE SET NULL,
  language TEXT,
  correlation_id TEXT,
  membership_id UUID REFERENCES guild_membership(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Memory record ───────────────────────────────────────────────────
CREATE TABLE memory_record (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id TEXT NOT NULL REFERENCES guild(id) ON DELETE CASCADE,
  member_id TEXT,
  category TEXT NOT NULL CHECK (category IN ('summary', 'fact', 'preference', 'action_outcome')),
  content TEXT NOT NULL,
  capability TEXT,
  confidence REAL NOT NULL DEFAULT 1.0,
  source_interaction_id UUID REFERENCES interaction(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ,
  membership_id UUID REFERENCES guild_membership(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT memory_record_confidence_bounds CHECK (confidence >= 0 AND confidence <= 1)
);

-- ── Identity alias (member naming memory) ───────────────────────────
CREATE TABLE identity_alias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id TEXT NOT NULL,
  guild_id TEXT REFERENCES guild(id) ON DELETE CASCADE,
  alias_type TEXT NOT NULL CHECK (alias_type IN ('username', 'nickname', 'preferred_name', 'first_name')),
  value TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('discord', 'explicit', 'inferred')),
  confidence REAL NOT NULL DEFAULT 1.0,
  confirmed BOOLEAN NOT NULL DEFAULT false,
  membership_id UUID REFERENCES guild_membership(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT identity_alias_confidence_bounds CHECK (confidence >= 0 AND confidence <= 1)
);

-- ── Action outcome ──────────────────────────────────────────────────
CREATE TABLE action_outcome (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interaction_id UUID NOT NULL REFERENCES interaction(id) ON DELETE CASCADE,
  guild_id TEXT NOT NULL REFERENCES guild(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  target_member_id TEXT,
  target_channel_id TEXT,
  success BOOLEAN NOT NULL,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  target_membership_id UUID REFERENCES guild_membership(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Embedding (pgvector, unconstrained dimension) ───────────────────
CREATE TABLE embedding (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_record_id UUID NOT NULL REFERENCES memory_record(id) ON DELETE CASCADE,
  embedding vector,
  model TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Operation log (two-phase persistence) ───────────────────────────
CREATE TABLE operation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interaction_id UUID REFERENCES interaction(id) ON DELETE SET NULL,
  correlation_id TEXT,
  parent_operation_id UUID REFERENCES operation_log(id) ON DELETE SET NULL,
  guild_id TEXT REFERENCES guild(id) ON DELETE SET NULL,
  member_id TEXT,
  membership_id UUID REFERENCES guild_membership(id) ON DELETE SET NULL,
  operation_name TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  provider_name TEXT,
  model TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  metadata JSONB NOT NULL DEFAULT '{}',
  duration_ms REAL,
  provider_duration_ms REAL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  started_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT operation_log_duration_non_negative CHECK (duration_ms IS NULL OR duration_ms >= 0),
  CONSTRAINT operation_log_provider_duration_non_negative CHECK (provider_duration_ms IS NULL OR provider_duration_ms >= 0),
  CONSTRAINT operation_log_ck_input_tokens_non_negative CHECK (input_tokens IS NULL OR input_tokens >= 0),
  CONSTRAINT operation_log_ck_output_tokens_non_negative CHECK (output_tokens IS NULL OR output_tokens >= 0)
);

-- ── Indexes: member ─────────────────────────────────────────────────
CREATE INDEX idx_member_guild ON member(guild_id);

-- ── Indexes: guild_membership ───────────────────────────────────────
CREATE INDEX idx_guild_membership_guild ON guild_membership(guild_id);
CREATE INDEX idx_guild_membership_user ON guild_membership(user_id);

-- ── Indexes: persona ────────────────────────────────────────────────
CREATE UNIQUE INDEX idx_persona_single_default
  ON persona (is_default) WHERE is_default = true;

-- ── Indexes: interaction ────────────────────────────────────────────
CREATE INDEX idx_interaction_guild ON interaction(guild_id);
CREATE INDEX idx_interaction_member ON interaction(member_id, guild_id);
CREATE INDEX idx_interaction_created ON interaction(created_at DESC);
CREATE INDEX idx_interaction_membership ON interaction(membership_id) WHERE membership_id IS NOT NULL;

-- ── Indexes: memory_record ──────────────────────────────────────────
CREATE INDEX idx_memory_record_guild ON memory_record(guild_id);
CREATE INDEX idx_memory_record_member ON memory_record(member_id, guild_id);
CREATE INDEX idx_memory_record_category ON memory_record(category);
CREATE INDEX idx_memory_record_created ON memory_record(created_at DESC);
CREATE INDEX idx_memory_record_membership ON memory_record(membership_id) WHERE membership_id IS NOT NULL;

-- ── Indexes: identity_alias ─────────────────────────────────────────
CREATE INDEX idx_identity_alias_member ON identity_alias(member_id);
CREATE INDEX idx_identity_alias_guild_member ON identity_alias(guild_id, member_id);
CREATE UNIQUE INDEX idx_identity_alias_unique
  ON identity_alias(member_id, COALESCE(guild_id, '__global__'), alias_type);
CREATE INDEX idx_identity_alias_membership ON identity_alias(membership_id) WHERE membership_id IS NOT NULL;

-- ── Indexes: action_outcome ─────────────────────────────────────────
CREATE INDEX idx_action_outcome_interaction ON action_outcome(interaction_id);
CREATE INDEX idx_action_outcome_guild ON action_outcome(guild_id);

-- ── Indexes: embedding ──────────────────────────────────────────────
-- Note: HNSW index omitted because the vector column is unconstrained.
-- Add once embedding dimension is stable:
--   CREATE INDEX idx_embedding_vector ON embedding
--     USING hnsw ((embedding::vector(N)) vector_cosine_ops);
CREATE UNIQUE INDEX idx_embedding_memory_record ON embedding(memory_record_id);

-- ── Indexes: operation_log ──────────────────────────────────────────
CREATE INDEX idx_op_log_created ON operation_log(created_at DESC);
CREATE INDEX idx_op_log_name ON operation_log(operation_name);
CREATE INDEX idx_op_log_model ON operation_log(model) WHERE model IS NOT NULL;
CREATE INDEX idx_op_log_provider ON operation_log(provider_name) WHERE provider_name IS NOT NULL;
CREATE INDEX idx_op_log_correlation ON operation_log(correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX idx_op_log_interaction ON operation_log(interaction_id) WHERE interaction_id IS NOT NULL;
CREATE INDEX idx_op_log_parent ON operation_log(parent_operation_id) WHERE parent_operation_id IS NOT NULL;
CREATE INDEX idx_op_log_membership ON operation_log(membership_id) WHERE membership_id IS NOT NULL;

-- ── Seed: default personas ──────────────────────────────────────────
INSERT INTO persona (name, description, system_prompt, response_style, is_default)
VALUES
  (
    'jarvis',
    'The default Jarvis persona — helpful, knowledgeable, and occasionally witty.',
    'You are Jarvis, a highly capable Discord guild assistant. You are helpful, knowledgeable, concise, and occasionally witty. You address guild members naturally and adapt to the conversational context. You are professional but not stiff — think of a sharp, dependable advisor with a dry sense of humour.',
    '{"tone": "professional-casual", "humor": "dry-wit", "verbosity": "concise"}',
    true
  ),
  (
    'friday',
    'An alternate persona — warm, upbeat, and proactive.',
    'You are Friday, a friendly and proactive Discord guild assistant. You are warm, encouraging, and like to anticipate what people need. You keep things light and positive, using a conversational tone. Think of a cheerful, can-do teammate who always has your back.',
    '{"tone": "warm-friendly", "humor": "lighthearted", "verbosity": "moderate"}',
    false
  )
ON CONFLICT (name) DO NOTHING;
