-- Migration: 004_research_artifacts
-- Description: Create research_artifacts table for debugging and audit trail

CREATE TABLE IF NOT EXISTS research_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  meeting_id UUID REFERENCES meetings(id) ON DELETE SET NULL,
  artifact_type TEXT NOT NULL,      -- 'inference' | 'harvest' | 'research' | 'serper' | 'firecrawl'
  payload JSONB NOT NULL,           -- Type-specific payload data
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for finding artifacts by meeting
CREATE INDEX IF NOT EXISTS idx_research_artifacts_meeting_id ON research_artifacts(meeting_id);

-- Index for finding artifacts by company
CREATE INDEX IF NOT EXISTS idx_research_artifacts_company_id ON research_artifacts(company_id);

-- Index for type-based queries
CREATE INDEX IF NOT EXISTS idx_research_artifacts_type ON research_artifacts(artifact_type);

-- Composite index for debugging (find recent artifacts by type)
CREATE INDEX IF NOT EXISTS idx_research_artifacts_type_created
  ON research_artifacts(artifact_type, created_at DESC);
