# Database Schema & Naming

## Source of Truth

`src/db/schema.sql` is the canonical schema definition for local bootstrapping.

The development reset flow recreates the database from that file and records the applied schema marker in `_migration`. This makes `schema.sql` the most useful reference when documenting the current relational model.

## Conventions

- **Relation names** use singular `snake_case`.
- **Primary keys** are named `id` when the key is a single column.
- **Foreign keys** follow `<referenced_relation>_id`.
- **Timestamps** use `TIMESTAMPTZ` with `created_at` and, where needed, `updated_at`.
- **Structured payloads** are stored as `JSONB` for settings, metadata, and response-style configuration.
- **Reserved identifiers** are avoided except for `"user"`, which remains quoted because `user` is reserved in PostgreSQL.

## Platform Requirements

The schema enables two PostgreSQL extensions:

- `vector` for semantic memory embeddings.
- `pgcrypto` for UUID generation via `gen_random_uuid()`.

## Schema Overview

### Core identity relations

- **`guild`** stores Discord guild metadata and guild-level settings.
- **`user`** stores the global Discord user identity.
- **`guild_membership`** is the normalized guild-scoped identity for a user within a guild.
- **`member`** remains available for backward-compatible guild-scoped member records.

The normalized path is `guild` → `user` → `guild_membership`. Newer relational links prefer `membership_id` when a stable guild-specific identity is needed.

### Conversation and persona relations

- **`persona`** stores system prompts, persona descriptions, and response-style settings.
- **`interaction`** stores the incoming request, the assistant response, surface, channel, correlation data, and optional links to `persona` and `guild_membership`.

`persona` includes a partial unique index that ensures only one row can be marked as the default persona.

### Memory and retrieval relations

- **`memory_record`** stores long-lived conversational memory with category, content, confidence, optional expiry, and optional links to both the originating interaction and a normalized guild membership.
- **`embedding`** stores the vector representation for a `memory_record`.
- **`identity_alias`** stores naming and identity preferences such as username, nickname, preferred name, and first name.

`memory_record` constrains `category` to `summary`, `fact`, `preference`, or `action_outcome`, and bounds `confidence` between `0` and `1`.

`embedding` has a one-to-one relationship with `memory_record` through a unique index on `memory_record_id`.

`identity_alias` supports both guild-scoped and global aliases and enforces one active alias per `(member_id, guild scope, alias_type)`.

### Action and observability relations

- **`action_outcome`** records the result of an executed action for a specific interaction.
- **`log`** stores unified structured log entries written by the Pino DB transport.
- **`_migration`** tracks applied schema bootstrap markers.

`log` stores every structured log entry emitted by the application when `LOG_DB_ENABLED=true`. Each row captures the Pino log level (as text), the message, the originating module, an optional source location, contextual identifiers (`correlation_id`, `interaction_id`, `guild_id`, `member_id`), an optional `status` and `duration_ms` for tracked operations, and a JSONB `metadata` column for all remaining fields.

## Relationship Model

The main write path is:

`guild` / `user` / `guild_membership` → `interaction` → `action_outcome`

The main memory path is:

`interaction` → `memory_record` → `embedding`

Identity enrichment is attached through:

`guild_membership` → `identity_alias`

Several relations also retain `guild_id` and `member_id` alongside `membership_id`. The implementation uses this combination to preserve compatibility with older flows while newer code can rely on normalized membership references.

## Constraints and Indexing

The schema emphasizes read paths used by the application runtime:

- Recent interactions and memories are indexed by descending creation time.
- Guild, member, interaction, and membership lookup paths are indexed explicitly.
- Optional relations such as `membership_id` and `interaction_id` use partial indexes where null values are common.
- `log` rows are indexed by `logged_at DESC`, `level`, `module`, `correlation_id`, `interaction_id`, and `guild_id`.

The vector column on `embedding` is intentionally left unconstrained, so no HNSW index is created until the embedding dimension is fixed.

## Seed Data

The schema seeds two personas:

- `jarvis` as the default persona.
- `friday` as an alternate persona.

These inserts are idempotent through `ON CONFLICT (name) DO NOTHING`.
