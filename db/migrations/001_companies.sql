-- Migration: 001_companies
-- Description: Create companies table for storing company information

CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  domain TEXT UNIQUE,
  industry TEXT,
  territory TEXT,           -- City/metro area
  state TEXT,               -- State abbreviation (e.g., 'TX', 'CA')
  location TEXT,            -- Full location string
  website TEXT,
  needs_review BOOLEAN DEFAULT FALSE,
  review_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for domain lookups (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_companies_domain ON companies(domain);

-- Index for state-based filtering
CREATE INDEX IF NOT EXISTS idx_companies_state ON companies(state);

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
