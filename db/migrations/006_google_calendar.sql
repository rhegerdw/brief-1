-- Migration: 006_google_calendar
-- Description: Create tables for Google Calendar push notification support

-- Watch channels for Google Calendar push notifications
CREATE TABLE IF NOT EXISTS google_watch_channels (
  channel_id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,        -- Google's resource ID for the watched calendar
  calendar_id TEXT NOT NULL,        -- The calendar being watched (e.g., user email)
  user_id TEXT NOT NULL,            -- User who owns this calendar
  token TEXT NOT NULL,              -- Verification token (sent back with notifications)
  expiration TIMESTAMPTZ NOT NULL,  -- When this channel expires (max 7 days)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for finding expiring channels (for renewal cron)
CREATE INDEX IF NOT EXISTS idx_channels_expiration
  ON google_watch_channels(expiration);

-- Index for finding channels by user
CREATE INDEX IF NOT EXISTS idx_channels_user_id
  ON google_watch_channels(user_id);

-- Sync state for incremental sync
-- Stores the syncToken for each calendar to enable delta syncs
CREATE TABLE IF NOT EXISTS google_sync_state (
  calendar_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  sync_token TEXT,                  -- Google's sync token for incremental sync
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for user lookups
CREATE INDEX IF NOT EXISTS idx_sync_state_user_id
  ON google_sync_state(user_id);

-- Track processed events to prevent duplicates
-- This prevents the same event from triggering multiple brief generations
CREATE TABLE IF NOT EXISTS processed_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_event_id TEXT UNIQUE,      -- Google Calendar event ID
  calendly_event_id TEXT UNIQUE,    -- Calendly event UUID
  meeting_id UUID REFERENCES meetings(id) ON DELETE SET NULL,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for deduplication lookups
CREATE INDEX IF NOT EXISTS idx_processed_events_google
  ON processed_events(google_event_id)
  WHERE google_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_processed_events_calendly
  ON processed_events(calendly_event_id)
  WHERE calendly_event_id IS NOT NULL;
