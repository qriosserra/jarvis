-- schema.sql: Consolidated Jarvis v1 schema (source of truth for dev bootstrapping)
--
-- This file represents the final effective schema produced by migrations 001–006.
-- When present, the migration runner applies it in a single transaction and records
-- a 'schema.sql' marker in _migrations. Numbered migrations in src/db/migrations/
-- are preserved for reference and as a fallback if this file is absent.

-- ── Extensions ──────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Migration tracking ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS _migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Guilds ──────────────────────────────────────────────────────────
CREATE TABLE guilds (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  settings JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Legacy members (guild-scoped, kept for backward compat) ─────────
CREATE TABLE members (
  id TEXT NOT NULL,
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  display_name TEXT,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, guild_id)
);

-- ── Users (global Discord identity) ─────────────────────────────────
CREATE TABLE users (
  id TEXT PRIMARY KEY,           -- Discord user id
  username TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Guild memberships (normalized guild-scoped identity) ────────────
CREATE TABLE guild_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (guild_id, user_id)
);

-- ── Personas ────────────────────────────────────────────────────────
CREATE TABLE personas (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  system_prompt TEXT NOT NULL,
  response_style JSONB NOT NULL DEFAULT '{}',
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Interactions ────────────────────────────────────────────────────
CREATE TABLE interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  surface TEXT NOT NULL CHECK (surface IN ('text', 'voice')),
  request_text TEXT NOT NULL,
  response_text TEXT,
  persona_id TEXT REFERENCES personas(id) ON DELETE SET NULL,
  language TEXT,
  correlation_id TEXT,
  membership_id UUID REFERENCES guild_memberships(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Memory records ──────────────────────────────────────────────────
CREATE TABLE memory_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  member_id TEXT,
  category TEXT NOT NULL CHECK (category IN ('summary', 'fact', 'preference', 'action_outcome')),
  content TEXT NOT NULL,
  capability TEXT,
  confidence REAL NOT NULL DEFAULT 1.0,
  source_interaction_id UUID REFERENCES interactions(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ,
  membership_id UUID REFERENCES guild_memberships(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT memory_records_confidence_bounds CHECK (confidence >= 0 AND confidence <= 1)
);

-- ── Identity aliases (member naming memory) ─────────────────────────
CREATE TABLE identity_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id TEXT NOT NULL,
  guild_id TEXT REFERENCES guilds(id) ON DELETE CASCADE,
  alias_type TEXT NOT NULL CHECK (alias_type IN ('username', 'nickname', 'preferred_name', 'first_name')),
  value TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('discord', 'explicit', 'inferred')),
  confidence REAL NOT NULL DEFAULT 1.0,
  confirmed BOOLEAN NOT NULL DEFAULT false,
  membership_id UUID REFERENCES guild_memberships(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT identity_aliases_confidence_bounds CHECK (confidence >= 0 AND confidence <= 1)
);

-- ── Action outcomes ─────────────────────────────────────────────────
CREATE TABLE action_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interaction_id UUID NOT NULL REFERENCES interactions(id) ON DELETE CASCADE,
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  target_member_id TEXT,
  target_channel_id TEXT,
  success BOOLEAN NOT NULL,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  target_membership_id UUID REFERENCES guild_memberships(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Embeddings (pgvector, unconstrained dimension) ──────────────────
CREATE TABLE embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_record_id UUID NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
  embedding vector,
  model TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Operation latencies (two-phase persistence) ─────────────────────
CREATE TABLE operation_latencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interaction_id UUID REFERENCES interactions(id) ON DELETE SET NULL,
  correlation_id TEXT,
  guild_id TEXT REFERENCES guilds(id) ON DELETE SET NULL,
  member_id TEXT,
  operation_name TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  parent_operation_id UUID REFERENCES operation_latencies(id) ON DELETE SET NULL,
  provider_name TEXT,
  model TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  duration_ms REAL,
  started_at TIMESTAMPTZ NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  membership_id UUID REFERENCES guild_memberships(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT operation_latencies_duration_non_negative CHECK (duration_ms IS NULL OR duration_ms >= 0)
);

-- ── Indexes: members ────────────────────────────────────────────────
CREATE INDEX idx_members_guild ON members(guild_id);

-- ── Indexes: guild_memberships ──────────────────────────────────────
CREATE INDEX idx_guild_memberships_guild ON guild_memberships(guild_id);
CREATE INDEX idx_guild_memberships_user ON guild_memberships(user_id);

-- ── Indexes: personas ───────────────────────────────────────────────
CREATE UNIQUE INDEX idx_personas_single_default
  ON personas (is_default) WHERE is_default = true;

-- ── Indexes: interactions ───────────────────────────────────────────
CREATE INDEX idx_interactions_guild ON interactions(guild_id);
CREATE INDEX idx_interactions_member ON interactions(member_id, guild_id);
CREATE INDEX idx_interactions_created ON interactions(created_at DESC);
CREATE INDEX idx_interactions_membership ON interactions(membership_id) WHERE membership_id IS NOT NULL;

-- ── Indexes: memory_records ─────────────────────────────────────────
CREATE INDEX idx_memory_records_guild ON memory_records(guild_id);
CREATE INDEX idx_memory_records_member ON memory_records(member_id, guild_id);
CREATE INDEX idx_memory_records_category ON memory_records(category);
CREATE INDEX idx_memory_records_created ON memory_records(created_at DESC);
CREATE INDEX idx_memory_records_membership ON memory_records(membership_id) WHERE membership_id IS NOT NULL;

-- ── Indexes: identity_aliases ───────────────────────────────────────
CREATE INDEX idx_identity_aliases_member ON identity_aliases(member_id);
CREATE INDEX idx_identity_aliases_guild_member ON identity_aliases(guild_id, member_id);
CREATE UNIQUE INDEX idx_identity_aliases_unique
  ON identity_aliases(member_id, COALESCE(guild_id, '__global__'), alias_type);
CREATE INDEX idx_identity_aliases_membership ON identity_aliases(membership_id) WHERE membership_id IS NOT NULL;

-- ── Indexes: action_outcomes ────────────────────────────────────────
CREATE INDEX idx_action_outcomes_interaction ON action_outcomes(interaction_id);
CREATE INDEX idx_action_outcomes_guild ON action_outcomes(guild_id);

-- ── Indexes: embeddings ─────────────────────────────────────────────
-- Note: HNSW index omitted because the vector column is unconstrained.
-- Add once embedding dimension is stable:
--   CREATE INDEX idx_embeddings_vector ON embeddings
--     USING hnsw ((embedding::vector(N)) vector_cosine_ops);
CREATE UNIQUE INDEX idx_embeddings_memory_record ON embeddings(memory_record_id);

-- ── Indexes: operation_latencies ────────────────────────────────────
CREATE INDEX idx_op_latencies_created ON operation_latencies(created_at DESC);
CREATE INDEX idx_op_latencies_name ON operation_latencies(operation_name);
CREATE INDEX idx_op_latencies_model ON operation_latencies(model) WHERE model IS NOT NULL;
CREATE INDEX idx_op_latencies_provider ON operation_latencies(provider_name) WHERE provider_name IS NOT NULL;
CREATE INDEX idx_op_latencies_correlation ON operation_latencies(correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX idx_op_latencies_interaction ON operation_latencies(interaction_id) WHERE interaction_id IS NOT NULL;
CREATE INDEX idx_op_latencies_parent ON operation_latencies(parent_operation_id) WHERE parent_operation_id IS NOT NULL;
CREATE INDEX idx_op_latencies_membership ON operation_latencies(membership_id) WHERE membership_id IS NOT NULL;

-- ── Seed: default personas ──────────────────────────────────────────
INSERT INTO personas (name, description, system_prompt, response_style, is_default)
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
