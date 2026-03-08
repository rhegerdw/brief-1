-- Migration: 007_llm_cache
-- Description: Create LLM cache table for caching AI responses

CREATE TABLE IF NOT EXISTS llm_cache (
  cache_key TEXT PRIMARY KEY,       -- Hash of model + prompt + params
  model TEXT NOT NULL,              -- Model identifier (e.g., 'gpt-4o-mini')
  prompt_hash TEXT NOT NULL,        -- Hash of the prompt for debugging
  response JSONB NOT NULL,          -- Cached response
  tokens_used INTEGER,              -- Token count for cost tracking
  latency_ms INTEGER,               -- Response latency
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ            -- Optional TTL
);

-- Index for cache lookups
CREATE INDEX IF NOT EXISTS idx_llm_cache_key ON llm_cache(cache_key);

-- Index for expiration cleanup
CREATE INDEX IF NOT EXISTS idx_llm_cache_expires
  ON llm_cache(expires_at)
  WHERE expires_at IS NOT NULL;

-- Index for model-based analytics
CREATE INDEX IF NOT EXISTS idx_llm_cache_model ON llm_cache(model);

-- Function to clean up expired cache entries (call periodically)
CREATE OR REPLACE FUNCTION cleanup_expired_llm_cache()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM llm_cache
  WHERE expires_at IS NOT NULL AND expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;
