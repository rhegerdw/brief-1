-- Migration: 003_meetingbrief_results
-- Description: Create meetingbrief_results table for storing generated briefs

CREATE TABLE IF NOT EXISTS meetingbrief_results (
  meeting_id UUID PRIMARY KEY REFERENCES meetings(id) ON DELETE CASCADE,
  attendee_name TEXT,
  attendee_email TEXT,
  company_name TEXT,
  brief_html TEXT,                  -- Generated HTML brief content
  citations JSONB,                  -- [{url: string, title: string}]
  metrics JSONB,                    -- {sources_count, generated_ms, news[], red_flags[], industry_key, questions}
  sources JSONB,                    -- [{url: string, snippet: string, title: string}]
  slack_notified_at TIMESTAMPTZ,    -- When Slack notification was sent
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for finding briefs that haven't been notified
CREATE INDEX IF NOT EXISTS idx_meetingbrief_results_not_notified
  ON meetingbrief_results(meeting_id)
  WHERE slack_notified_at IS NULL;

-- Index for recent briefs
CREATE INDEX IF NOT EXISTS idx_meetingbrief_results_created_at
  ON meetingbrief_results(created_at DESC);
