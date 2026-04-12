-- 004-operation-latencies.sql: Per-operation latency tracking

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
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
  duration_ms REAL NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for common analysis paths
CREATE INDEX idx_op_latencies_created ON operation_latencies(created_at DESC);
CREATE INDEX idx_op_latencies_name ON operation_latencies(operation_name);
CREATE INDEX idx_op_latencies_model ON operation_latencies(model) WHERE model IS NOT NULL;
CREATE INDEX idx_op_latencies_provider ON operation_latencies(provider_name) WHERE provider_name IS NOT NULL;
CREATE INDEX idx_op_latencies_correlation ON operation_latencies(correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX idx_op_latencies_interaction ON operation_latencies(interaction_id) WHERE interaction_id IS NOT NULL;
CREATE INDEX idx_op_latencies_parent ON operation_latencies(parent_operation_id) WHERE parent_operation_id IS NOT NULL;
