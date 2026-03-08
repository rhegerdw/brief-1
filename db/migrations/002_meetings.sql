-- Migration: 002_meetings
-- Description: Create meetings table for storing calendar events

CREATE TABLE IF NOT EXISTS meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  attendee TEXT,                    -- Attendee name
  attendee_email TEXT NOT NULL,     -- Attendee email (required)
  starts_at TIMESTAMPTZ NOT NULL,   -- Meeting start time
  ends_at TIMESTAMPTZ,              -- Meeting end time
  join_url TEXT,                    -- Video conference link (Zoom, Meet, etc.)
  external_event_id TEXT,           -- Calendly UUID or Google event ID
  source TEXT DEFAULT 'calendly',   -- 'calendly' | 'google' | 'manual'
  event_name TEXT,                  -- Meeting title/summary
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for company lookups
CREATE INDEX IF NOT EXISTS idx_meetings_company_id ON meetings(company_id);

-- Index for finding meetings by external ID (deduplication)
CREATE UNIQUE INDEX IF NOT EXISTS idx_meetings_external_event_id ON meetings(external_event_id) WHERE external_event_id IS NOT NULL;

-- Index for finding meetings by attendee email
CREATE INDEX IF NOT EXISTS idx_meetings_attendee_email ON meetings(attendee_email);

-- Index for time-based queries
CREATE INDEX IF NOT EXISTS idx_meetings_starts_at ON meetings(starts_at);

-- Composite index for finding recent meetings by email (Fireflies matching)
CREATE INDEX IF NOT EXISTS idx_meetings_email_starts ON meetings(attendee_email, starts_at DESC);

-- Auto-update trigger
CREATE TRIGGER meetings_updated_at
  BEFORE UPDATE ON meetings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
