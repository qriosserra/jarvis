-- 006-identity-refactor.sql: Normalized identity model
--
-- Introduces a global `users` table and guild-scoped `guild_memberships`
-- table, adds transitional `membership_id` columns to dependent tables,
-- and backfills data from the existing `members` table.

-- ── New core identity tables ─────────────────────────────────────────

CREATE TABLE users (
  id TEXT PRIMARY KEY,           -- Discord user id
  username TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE guild_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (guild_id, user_id)
);

CREATE INDEX idx_guild_memberships_guild ON guild_memberships(guild_id);
CREATE INDEX idx_guild_memberships_user ON guild_memberships(user_id);

-- ── Transitional columns on dependent tables ─────────────────────────
-- These are nullable during the transition period. Once all reads/writes
-- have moved to membership_id, the legacy member_id columns can be dropped.

ALTER TABLE interactions
  ADD COLUMN membership_id UUID REFERENCES guild_memberships(id) ON DELETE SET NULL;

ALTER TABLE memory_records
  ADD COLUMN membership_id UUID REFERENCES guild_memberships(id) ON DELETE SET NULL;

ALTER TABLE identity_aliases
  ADD COLUMN membership_id UUID REFERENCES guild_memberships(id) ON DELETE SET NULL;

ALTER TABLE action_outcomes
  ADD COLUMN target_membership_id UUID REFERENCES guild_memberships(id) ON DELETE SET NULL;

ALTER TABLE operation_latencies
  ADD COLUMN membership_id UUID REFERENCES guild_memberships(id) ON DELETE SET NULL;

-- ── Indexes on new columns ───────────────────────────────────────────

CREATE INDEX idx_interactions_membership ON interactions(membership_id) WHERE membership_id IS NOT NULL;
CREATE INDEX idx_memory_records_membership ON memory_records(membership_id) WHERE membership_id IS NOT NULL;
CREATE INDEX idx_identity_aliases_membership ON identity_aliases(membership_id) WHERE membership_id IS NOT NULL;
CREATE INDEX idx_op_latencies_membership ON operation_latencies(membership_id) WHERE membership_id IS NOT NULL;

-- ── Backfill users from existing members ─────────────────────────────
-- The members table has composite PK (id, guild_id) where id is the
-- Discord user id. We deduplicate across guilds to populate users.

INSERT INTO users (id, username, created_at, updated_at)
SELECT DISTINCT ON (id)
  id,
  username,
  joined_at,
  updated_at
FROM members
ORDER BY id, updated_at DESC
ON CONFLICT (id) DO NOTHING;

-- ── Backfill guild_memberships from existing members ─────────────────

INSERT INTO guild_memberships (guild_id, user_id, display_name, created_at, updated_at)
SELECT
  guild_id,
  id,
  display_name,
  joined_at,
  updated_at
FROM members
ON CONFLICT (guild_id, user_id) DO NOTHING;

-- ── Backfill membership_id on interactions ───────────────────────────

UPDATE interactions i
SET membership_id = gm.id
FROM guild_memberships gm
WHERE gm.guild_id = i.guild_id
  AND gm.user_id = i.member_id;

-- ── Backfill membership_id on memory_records ─────────────────────────

UPDATE memory_records mr
SET membership_id = gm.id
FROM guild_memberships gm
WHERE gm.guild_id = mr.guild_id
  AND gm.user_id = mr.member_id
  AND mr.member_id IS NOT NULL;

-- ── Backfill membership_id on identity_aliases ───────────────────────
-- identity_aliases has nullable guild_id; only backfill guild-scoped rows.

UPDATE identity_aliases ia
SET membership_id = gm.id
FROM guild_memberships gm
WHERE ia.guild_id IS NOT NULL
  AND gm.guild_id = ia.guild_id
  AND gm.user_id = ia.member_id;

-- ── Backfill target_membership_id on action_outcomes ─────────────────

UPDATE action_outcomes ao
SET target_membership_id = gm.id
FROM guild_memberships gm
WHERE ao.target_member_id IS NOT NULL
  AND gm.guild_id = ao.guild_id
  AND gm.user_id = ao.target_member_id;

-- ── Backfill membership_id on operation_latencies ────────────────────

UPDATE operation_latencies ol
SET membership_id = gm.id
FROM guild_memberships gm
WHERE ol.member_id IS NOT NULL
  AND ol.guild_id IS NOT NULL
  AND gm.guild_id = ol.guild_id
  AND gm.user_id = ol.member_id;

-- ── Additional constraints ───────────────────────────────────────────

-- Confidence bounds for alias and memory tables
ALTER TABLE identity_aliases
  ADD CONSTRAINT identity_aliases_confidence_bounds CHECK (confidence >= 0 AND confidence <= 1);

ALTER TABLE memory_records
  ADD CONSTRAINT memory_records_confidence_bounds CHECK (confidence >= 0 AND confidence <= 1);

-- Non-negative duration check on operation_latencies
ALTER TABLE operation_latencies
  ADD CONSTRAINT operation_latencies_duration_non_negative CHECK (duration_ms IS NULL OR duration_ms >= 0);

-- Single-default-persona unique partial index
CREATE UNIQUE INDEX idx_personas_single_default
  ON personas (is_default) WHERE is_default = true;
