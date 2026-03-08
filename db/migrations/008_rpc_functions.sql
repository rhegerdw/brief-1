-- Migration: 008_rpc_functions
-- Description: Create RPC functions for common operations

-- Upsert company and return ID
CREATE OR REPLACE FUNCTION upsert_company(
  p_domain TEXT,
  p_name TEXT DEFAULT NULL,
  p_industry TEXT DEFAULT NULL,
  p_territory TEXT DEFAULT NULL,
  p_state TEXT DEFAULT NULL,
  p_website TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_company_id UUID;
BEGIN
  -- Try to find existing company by domain
  SELECT id INTO v_company_id
  FROM companies
  WHERE domain = p_domain;

  IF v_company_id IS NULL THEN
    -- Insert new company
    INSERT INTO companies (domain, name, industry, territory, state, website)
    VALUES (p_domain, COALESCE(p_name, p_domain), p_industry, p_territory, p_state, p_website)
    RETURNING id INTO v_company_id;
  ELSE
    -- Update existing company with new data if provided
    UPDATE companies SET
      name = COALESCE(p_name, name),
      industry = COALESCE(p_industry, industry),
      territory = COALESCE(p_territory, territory),
      state = COALESCE(p_state, state),
      website = COALESCE(p_website, website),
      updated_at = NOW()
    WHERE id = v_company_id;
  END IF;

  RETURN v_company_id;
END;
$$ LANGUAGE plpgsql;

-- Upsert meeting and return ID
CREATE OR REPLACE FUNCTION upsert_meeting(
  p_company_id UUID,
  p_attendee_email TEXT,
  p_starts_at TIMESTAMPTZ,
  p_external_event_id TEXT DEFAULT NULL,
  p_attendee TEXT DEFAULT NULL,
  p_join_url TEXT DEFAULT NULL,
  p_source TEXT DEFAULT 'calendly',
  p_event_name TEXT DEFAULT NULL,
  p_ends_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_meeting_id UUID;
BEGIN
  -- Try to find existing meeting by external event ID
  IF p_external_event_id IS NOT NULL THEN
    SELECT id INTO v_meeting_id
    FROM meetings
    WHERE external_event_id = p_external_event_id;
  END IF;

  IF v_meeting_id IS NULL THEN
    -- Insert new meeting
    INSERT INTO meetings (
      company_id, attendee_email, starts_at, external_event_id,
      attendee, join_url, source, event_name, ends_at
    )
    VALUES (
      p_company_id, p_attendee_email, p_starts_at, p_external_event_id,
      p_attendee, p_join_url, p_source, p_event_name, p_ends_at
    )
    RETURNING id INTO v_meeting_id;
  ELSE
    -- Update existing meeting
    UPDATE meetings SET
      company_id = COALESCE(p_company_id, company_id),
      attendee = COALESCE(p_attendee, attendee),
      join_url = COALESCE(p_join_url, join_url),
      event_name = COALESCE(p_event_name, event_name),
      ends_at = COALESCE(p_ends_at, ends_at),
      updated_at = NOW()
    WHERE id = v_meeting_id;
  END IF;

  RETURN v_meeting_id;
END;
$$ LANGUAGE plpgsql;

-- Check if an event has already been processed
CREATE OR REPLACE FUNCTION is_event_processed(
  p_google_event_id TEXT DEFAULT NULL,
  p_calendly_event_id TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
  IF p_google_event_id IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM processed_events WHERE google_event_id = p_google_event_id
    );
  ELSIF p_calendly_event_id IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM processed_events WHERE calendly_event_id = p_calendly_event_id
    );
  END IF;
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql;

-- Mark an event as processed
CREATE OR REPLACE FUNCTION mark_event_processed(
  p_meeting_id UUID,
  p_google_event_id TEXT DEFAULT NULL,
  p_calendly_event_id TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO processed_events (meeting_id, google_event_id, calendly_event_id)
  VALUES (p_meeting_id, p_google_event_id, p_calendly_event_id)
  ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- Get question templates for an industry (with fallback to default)
CREATE OR REPLACE FUNCTION get_questions_for_industry(p_industry_key TEXT)
RETURNS TEXT[] AS $$
DECLARE
  v_questions TEXT[];
BEGIN
  -- Try to find questions for the specific industry
  SELECT questions INTO v_questions
  FROM question_templates
  WHERE industry_key = LOWER(p_industry_key) AND active = TRUE;

  -- Fallback to default if not found
  IF v_questions IS NULL THEN
    SELECT questions INTO v_questions
    FROM question_templates
    WHERE industry_key = 'default' AND active = TRUE;
  END IF;

  RETURN COALESCE(v_questions, ARRAY[]::TEXT[]);
END;
$$ LANGUAGE plpgsql;
