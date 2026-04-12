-- 003-flexible-embedding-dimension.sql
-- Change the embeddings vector column from a fixed 1536 dimensions
-- to an unconstrained vector so different embedding providers/models
-- (e.g. xAI, OpenAI with different sizes) can be used.
--
-- Note: the HNSW index must be rebuilt because it is dimension-specific.

-- Drop the existing HNSW index (dimension-locked to 1536)
DROP INDEX IF EXISTS idx_embeddings_vector;

-- Alter the column to accept any vector dimension
ALTER TABLE embeddings
  ALTER COLUMN embedding TYPE vector USING embedding::vector;

-- Note: HNSW index is NOT recreated here because pgvector requires a fixed
-- dimension for HNSW indexes and the column is now unconstrained. The index
-- can be added once the embedding provider dimension is known, e.g.:
--   CREATE INDEX idx_embeddings_vector ON embeddings
--     USING hnsw ((embedding::vector(N)) vector_cosine_ops);
-- Queries using cosine distance (<=> operator) still work without the index.
