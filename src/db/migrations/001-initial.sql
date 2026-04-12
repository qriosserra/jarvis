-- 001-initial.sql: Core schema for Jarvis v1
-- Includes pgvector extension for embedding storage (task 2.2)

CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Migration tracking
CREATE TABLE IF NOT EXISTS _migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Guilds
CREATE TABLE guilds (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  settings JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Members (guild-scoped)
CREATE TABLE members (
  id TEXT NOT NULL,
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  display_name TEXT,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, guild_id)
);

-- Personas
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

-- Interactions (interaction history)
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Memory records
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Identity aliases (member naming memory)
CREATE TABLE identity_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id TEXT NOT NULL,
  guild_id TEXT REFERENCES guilds(id) ON DELETE CASCADE,
  alias_type TEXT NOT NULL CHECK (alias_type IN ('username', 'nickname', 'preferred_name', 'first_name')),
  value TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('discord', 'explicit', 'inferred')),
  confidence REAL NOT NULL DEFAULT 1.0,
  confirmed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Action outcomes
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Embeddings (pgvector)
CREATE TABLE embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_record_id UUID NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
  embedding vector(1536),
  model TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes: members
CREATE INDEX idx_members_guild ON members(guild_id);

-- Indexes: interactions
CREATE INDEX idx_interactions_guild ON interactions(guild_id);
CREATE INDEX idx_interactions_member ON interactions(member_id, guild_id);
CREATE INDEX idx_interactions_created ON interactions(created_at DESC);

-- Indexes: memory_records
CREATE INDEX idx_memory_records_guild ON memory_records(guild_id);
CREATE INDEX idx_memory_records_member ON memory_records(member_id, guild_id);
CREATE INDEX idx_memory_records_category ON memory_records(category);
CREATE INDEX idx_memory_records_created ON memory_records(created_at DESC);

-- Indexes: identity_aliases
CREATE INDEX idx_identity_aliases_member ON identity_aliases(member_id);
CREATE INDEX idx_identity_aliases_guild_member ON identity_aliases(guild_id, member_id);
CREATE UNIQUE INDEX idx_identity_aliases_unique
  ON identity_aliases(member_id, COALESCE(guild_id, '__global__'), alias_type);

-- Indexes: action_outcomes
CREATE INDEX idx_action_outcomes_interaction ON action_outcomes(interaction_id);
CREATE INDEX idx_action_outcomes_guild ON action_outcomes(guild_id);

-- Indexes: embeddings (HNSW for cosine similarity)
CREATE INDEX idx_embeddings_vector ON embeddings USING hnsw (embedding vector_cosine_ops);
CREATE UNIQUE INDEX idx_embeddings_memory_record ON embeddings(memory_record_id);
