# Brief Pipeline - Porting Plan

> Standalone meeting brief generation pipeline extracted from OutSearched

## Overview

This document outlines the plan for porting the Calendly pre-meeting brief pipeline to a standalone repository (`/brief`), including architectural decisions and calendar integration options (Calendly and Google Calendar).

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Porting Checklist](#porting-checklist)
3. [File Structure](#file-structure)
4. [Core Components](#core-components)
5. [Calendar Integrations](#calendar-integrations)
   - [Option 1: Calendly (Current)](#option-1-calendly-current)
   - [Option 2: Google Calendar API Push Notifications](#option-2-google-calendar-api-push-notifications)
   - [Option 3: Google Apps Script](#option-3-google-apps-script)
6. [Database Schema](#database-schema)
7. [Environment Variables](#environment-variables)
8. [Deployment](#deployment)
9. [Migration Steps](#migration-steps)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CALENDAR EVENT SOURCES                               │
├─────────────────┬─────────────────────┬─────────────────────────────────────┤
│   Calendly      │   Google Calendar   │   Google Apps Script                │
│   Webhook       │   Push Notification │   (EventUpdated trigger)            │
│   (invitee.created) │  (watch channel)   │                                    │
└────────┬────────┴──────────┬──────────┴────────────────┬────────────────────┘
         │                   │                           │
         ▼                   ▼                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     UNIFIED EVENT HANDLER                                    │
│  Normalize event → Extract attendee info → Infer domain/industry            │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         15-STEP PIPELINE                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│  1. fetchEventDetails      │  6. fetchQuestionTemplates  │ 11. scoreMandates │
│  2. parseFormInputs        │  7. buildOrgName            │ 12. prefetchSmartlead │
│  3. inferDomainIndustry    │  8. generateMeetingBrief    │ 13. persistBrief  │
│  4. upsertCompanyMeeting   │  9. harvestEnrichment       │ 14. createBriefUrl│
│  5. recordArtifacts        │ 10. rewriteQuestions        │ 15. sendSlackNotif│
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              OUTPUT                                          │
├────────────────────────────┬────────────────────────────────────────────────┤
│  PostgreSQL (Supabase)     │  Slack Notifications                           │
│  - meetingbrief_results    │  - Channel post with summary                   │
│  - companies               │  - CEO DM with top fit                         │
│  - meetings                │                                                │
└────────────────────────────┴────────────────────────────────────────────────┘
```

---

## Porting Checklist

### Phase 1: Core Infrastructure
- [ ] Initialize new repo with pnpm + TypeScript
- [ ] Set up Vercel project configuration
- [ ] Configure Supabase connection
- [ ] Port environment configuration (`src/config/env.ts`)

### Phase 2: Pipeline Core
- [ ] Port pipeline orchestrator (`calendlyPrebrief.ts`)
- [ ] Port 15 pipeline steps (`calendlyPrebriefSteps.ts`)
- [ ] Port `PipelineContext` interface and types

### Phase 3: Integrations
- [ ] Supabase client + RPCs
- [ ] Serper (Google search)
- [ ] Firecrawl (web scraping)
- [ ] Harvest (LinkedIn enrichment)
- [ ] Slack (notifications)
- [ ] OpenAI/Gemini (LLM wrappers)

### Phase 4: Calendar Sources
- [ ] Port Calendly webhook + client
- [ ] Implement Google Calendar push notifications
- [ ] (Optional) Implement Google Apps Script trigger

### Phase 5: Views & APIs
- [ ] Port brief view endpoint (`/api/view/meetingBrief`)
- [ ] Port health check endpoints

### Phase 6: Testing & Deployment
- [ ] Set up test fixtures
- [ ] Configure Vercel crons (if needed)
- [ ] Deploy and verify

---

## File Structure

```
/brief
├── /api                              # Vercel serverless endpoints
│   ├── /webhooks
│   │   ├── calendly.ts               # Calendly webhook handler
│   │   └── google-calendar.ts        # Google Calendar push notification handler
│   ├── /view
│   │   └── brief.ts                  # HTML brief viewer
│   ├── /internal
│   │   └── refresh-watch.ts          # Google Calendar channel renewal
│   └── health.ts                     # Health check
│
├── /src
│   ├── /pipeline
│   │   ├── orchestrator.ts           # Main pipeline runner
│   │   ├── steps.ts                  # 15 composable steps
│   │   ├── context.ts                # PipelineContext interface
│   │   └── types.ts                  # Shared types
│   │
│   ├── /calendar                     # Calendar adapters
│   │   ├── adapter.ts                # Abstract calendar adapter
│   │   ├── calendly.ts               # Calendly implementation
│   │   └── google.ts                 # Google Calendar implementation
│   │
│   ├── /integrations
│   │   ├── /supabase
│   │   │   └── client.ts
│   │   ├── /serper
│   │   │   └── client.ts
│   │   ├── /firecrawl
│   │   │   └── client.ts
│   │   ├── /harvest
│   │   │   └── client.ts
│   │   ├── /slack
│   │   │   ├── client.ts
│   │   │   └── sendBrief.ts
│   │   └── /research
│   │       └── MeetingBriefPipeline.ts
│   │
│   ├── /ai
│   │   ├── openai.ts
│   │   ├── gemini.ts
│   │   └── anthropic.ts
│   │
│   ├── /utils
│   │   ├── domain.ts
│   │   ├── territory.ts
│   │   └── questions.ts
│   │
│   └── /config
│       └── env.ts
│
├── /db
│   └── /migrations
│       ├── 001_companies.sql
│       ├── 002_meetings.sql
│       └── 003_meetingbrief_results.sql
│
├── package.json
├── tsconfig.json
├── vercel.json
└── .env.example
```

---

## Core Components

### Pipeline Steps (15 Sequential Steps)

| Step | Name | Purpose |
|------|------|---------|
| 1 | `fetchEventDetails` | Fetch authoritative event from calendar API |
| 2 | `parseFormInputs` | Extract company name, website, industry from intake form |
| 3 | `inferDomainIndustry` | Use LLM to classify industry and infer domain |
| 4 | `upsertCompanyMeeting` | Create/update company and meeting records |
| 5 | `recordArtifacts` | Store inference metadata for debugging |
| 6 | `fetchQuestionTemplates` | Load industry-specific discovery questions |
| 7 | `buildOrgName` | Construct clean organization name |
| 8 | `generateMeetingBrief` | Run research pipeline (Serper → Firecrawl → LLM) |
| 9 | `harvestEnrichment` | Fetch LinkedIn data (company, person) |
| 10 | `rewriteQuestions` | Use Gemini to improve question wording |
| 11 | `scoreMandates` | Match against buyer mandates (optional) |
| 12 | `prefetchSmartlead` | Cache email thread context (optional) |
| 13 | `persistBrief` | Save brief to database |
| 14 | `createBriefUrl` | Generate view URL |
| 15 | `sendSlackNotifications` | Post to Slack channel + DM |

### PipelineContext Interface

```typescript
interface PipelineContext {
  // Source event (normalized)
  source: 'calendly' | 'google' | 'manual'
  rawPayload: unknown
  requestId?: string

  // Event details
  eventId?: string
  eventStartTime?: Date
  eventEndTime?: Date
  eventName?: string
  joinUrl?: string | null

  // Attendee
  attendeeEmail?: string
  attendeeName?: string

  // Form data (if available)
  companyNameFromForm?: string
  websiteFromForm?: string
  industryFromForm?: string
  questionsAndAnswers?: Array<{ question: string; answer: string }>

  // Inferred data
  inferred?: {
    domain?: string
    industryKey?: string
    confidence?: number
    method?: string
  }
  territory?: string      // City/metro
  territoryState?: string // State abbreviation

  // Database records
  companyId?: string
  meetingId?: string
  companyRow?: { name?: string; location?: string }

  // Research results
  orgName?: string
  displayName?: string
  pinnedUrl?: string | null
  briefResult?: {
    brief_html?: string
    citations?: Array<{ url?: string; title?: string }>
    metrics?: Record<string, unknown>
    sources?: Array<{ url?: string; title?: string }>
  }
  hqLocation?: string

  // Output
  linkUrl?: string
  slackNotifiedAt?: Date

  // Logging
  log: PipelineLogger
}
```

---

## Calendar Integrations

### Option 1: Calendly (Current)

**How it works:**
1. User books meeting via Calendly
2. Calendly sends `invitee.created` webhook
3. Webhook handler validates HMAC-SHA256 signature
4. Pipeline extracts attendee info from webhook payload

**Webhook Payload:**
```json
{
  "event": "invitee.created",
  "payload": {
    "event": {
      "uuid": "abc-123",
      "start_time": "2024-03-15T14:00:00Z",
      "name": "Discovery Call",
      "status": "active"
    },
    "invitee": {
      "name": "John Smith",
      "email": "john@acme.com"
    },
    "questions_and_answers": [
      { "question": "Company Name", "answer": "Acme Corp" },
      { "question": "Company Website", "answer": "https://acme.com" }
    ]
  }
}
```

**Setup:**
1. Create webhook subscription in Calendly dashboard
2. Set signing secret in `CALENDLY_SIGNING_SECRET`
3. Point to `POST /api/webhooks/calendly`

---

### Option 2: Google Calendar API Push Notifications

**How it works:**
1. App registers a "watch" channel on user's calendar
2. Google sends push notifications when events change
3. App performs incremental sync to get changed events
4. Pipeline runs for new meetings with external attendees

**Key Concepts:**

| Concept | Description |
|---------|-------------|
| Watch Channel | Registration to receive notifications for a calendar |
| Sync Token | Token for incremental sync (only get changes) |
| Push Notification | HTTP POST from Google when something changes |
| Channel Expiration | Channels expire after ~7 days (must renew) |

**Architecture:**

```
┌──────────────────┐     ┌───────────────────┐     ┌──────────────────┐
│  Google Calendar │────▶│  Push Notification │────▶│  Webhook Handler │
│  (user's events) │     │  (POST to your URL)│     │  /api/webhooks/  │
└──────────────────┘     └───────────────────┘     │  google-calendar │
                                                    └────────┬─────────┘
                                                             │
                              ┌───────────────────────────────┘
                              ▼
                    ┌──────────────────┐
                    │ Incremental Sync │
                    │ Events.list()    │
                    │ + syncToken      │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │ Filter: External │
                    │ attendees only   │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │ Run Brief        │
                    │ Pipeline         │
                    └──────────────────┘
```

**Implementation Steps:**

#### 1. Google Cloud Setup

```bash
# Enable Calendar API in Google Cloud Console
# Create OAuth 2.0 credentials
# Set authorized redirect URIs
```

**Required Scopes:**
```
https://www.googleapis.com/auth/calendar.readonly
https://www.googleapis.com/auth/calendar.events.readonly
```

#### 2. Register Watch Channel

```typescript
// POST https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events/watch

import { google } from 'googleapis'

async function registerWatch(auth: OAuth2Client, calendarId: string) {
  const calendar = google.calendar({ version: 'v3', auth })

  const channelId = crypto.randomUUID()
  const channelToken = crypto.randomBytes(32).toString('hex')

  const response = await calendar.events.watch({
    calendarId,
    requestBody: {
      id: channelId,
      type: 'web_hook',
      address: 'https://your-app.com/api/webhooks/google-calendar',
      token: channelToken,
      expiration: String(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    },
  })

  // Store channel info in database for renewal
  await db.insert('google_watch_channels', {
    channel_id: channelId,
    resource_id: response.data.resourceId,
    calendar_id: calendarId,
    token: channelToken,
    expiration: new Date(Number(response.data.expiration)),
  })

  return response.data
}
```

#### 3. Handle Push Notifications

```typescript
// api/webhooks/google-calendar.ts

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).end()
  }

  // Validate headers
  const channelId = req.headers['x-goog-channel-id'] as string
  const resourceState = req.headers['x-goog-resource-state'] as string
  const channelToken = req.headers['x-goog-channel-token'] as string

  // Verify channel exists and token matches
  const channel = await db.findOne('google_watch_channels', { channel_id: channelId })
  if (!channel || channel.token !== channelToken) {
    return res.status(401).json({ error: 'Invalid channel' })
  }

  // Acknowledge quickly
  res.status(200).end()

  // Handle sync message (initial registration)
  if (resourceState === 'sync') {
    console.log('Watch channel registered successfully')
    return
  }

  // Handle event change
  if (resourceState === 'exists') {
    setImmediate(async () => {
      await performIncrementalSync(channel.calendar_id)
    })
  }
}
```

#### 4. Incremental Sync

```typescript
async function performIncrementalSync(calendarId: string) {
  const calendar = google.calendar({ version: 'v3', auth })

  // Get stored sync token
  const syncState = await db.findOne('google_sync_state', { calendar_id: calendarId })

  const params: any = {
    calendarId,
    singleEvents: true,
    orderBy: 'updated',
  }

  if (syncState?.sync_token) {
    params.syncToken = syncState.sync_token
  } else {
    // First sync - get events from now onwards
    params.timeMin = new Date().toISOString()
  }

  const response = await calendar.events.list(params)

  // Store new sync token
  await db.upsert('google_sync_state', {
    calendar_id: calendarId,
    sync_token: response.data.nextSyncToken,
    updated_at: new Date(),
  })

  // Process new/updated events
  for (const event of response.data.items || []) {
    // Only process events with external attendees
    const externalAttendees = event.attendees?.filter(
      (a) => !a.self && !a.email?.endsWith('@your-domain.com')
    )

    if (externalAttendees?.length && event.status !== 'cancelled') {
      // Check if we've already processed this event
      const existing = await db.findOne('processed_events', { google_event_id: event.id })
      if (!existing) {
        await runBriefPipeline({
          source: 'google',
          eventId: event.id,
          eventStartTime: new Date(event.start?.dateTime || event.start?.date!),
          attendeeEmail: externalAttendees[0].email!,
          attendeeName: externalAttendees[0].displayName,
          eventName: event.summary,
          joinUrl: event.hangoutLink,
        })

        await db.insert('processed_events', {
          google_event_id: event.id,
          processed_at: new Date(),
        })
      }
    }
  }
}
```

#### 5. Channel Renewal Cron

Channels expire after ~7 days. Set up a cron job to renew them.

```typescript
// api/internal/refresh-watch.ts (called by cron)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Find channels expiring in next hour
  const expiringChannels = await db.query(`
    SELECT * FROM google_watch_channels
    WHERE expiration < NOW() + INTERVAL '1 hour'
  `)

  for (const channel of expiringChannels) {
    // Stop old channel
    await calendar.channels.stop({
      requestBody: {
        id: channel.channel_id,
        resourceId: channel.resource_id,
      },
    })

    // Create new channel
    await registerWatch(auth, channel.calendar_id)

    // Delete old channel record
    await db.delete('google_watch_channels', { channel_id: channel.channel_id })
  }

  res.status(200).json({ renewed: expiringChannels.length })
}
```

**vercel.json cron:**
```json
{
  "crons": [
    {
      "path": "/api/internal/refresh-watch",
      "schedule": "0 * * * *"
    }
  ]
}
```

**Pros:**
- Real-time notifications
- Official API with good reliability
- Works with any calendar (not just Calendly bookings)

**Cons:**
- Requires OAuth flow for each user
- Channel management complexity
- Notifications don't include event data (requires sync call)
- Channels expire and need renewal

**References:**
- [Google Calendar Push Notifications](https://developers.google.com/workspace/calendar/api/guides/push)
- [CalendHub Webhook Guide](https://calendhub.com/blog/calendar-webhook-integration-developer-guide-2025/)

---

### Option 3: Google Apps Script

**How it works:**
1. Deploy Apps Script bound to user's Google Workspace
2. Create installable trigger on calendar
3. Trigger fires when events are created/updated
4. Script calls your webhook with event data

**Key Advantage:** No channel expiration, simpler OAuth

**Architecture:**

```
┌──────────────────┐     ┌───────────────────┐     ┌──────────────────┐
│  Google Calendar │────▶│  Apps Script      │────▶│  Your Webhook    │
│  (EventUpdated)  │     │  onEventUpdated() │     │  /api/webhooks/  │
└──────────────────┘     └───────────────────┘     │  apps-script     │
                                                    └──────────────────┘
```

**Implementation:**

#### 1. Apps Script Code

```javascript
// Code.gs - Deploy as Google Apps Script

const WEBHOOK_URL = 'https://your-app.com/api/webhooks/apps-script'
const WEBHOOK_SECRET = 'your-shared-secret'

/**
 * Creates the calendar trigger (run once during setup)
 */
function createCalendarTrigger() {
  // Delete existing triggers first
  const triggers = ScriptApp.getProjectTriggers()
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'onCalendarUpdate') {
      ScriptApp.deleteTrigger(trigger)
    }
  })

  // Create new trigger
  ScriptApp.newTrigger('onCalendarUpdate')
    .forUserCalendar(Session.getActiveUser().getEmail())
    .onEventUpdated()
    .create()

  Logger.log('Calendar trigger created')
}

/**
 * Triggered when calendar events change
 */
function onCalendarUpdate(e) {
  const calendarId = e.calendarId

  // Get sync token from properties (or null for first run)
  const props = PropertiesService.getUserProperties()
  const syncToken = props.getProperty('syncToken_' + calendarId)

  // Perform incremental sync
  const calendar = CalendarApp.getCalendarById(calendarId)
  const events = Calendar.Events.list(calendarId, {
    syncToken: syncToken || undefined,
    timeMin: syncToken ? undefined : new Date().toISOString(),
    singleEvents: true,
    orderBy: 'updated',
  })

  // Store new sync token
  if (events.nextSyncToken) {
    props.setProperty('syncToken_' + calendarId, events.nextSyncToken)
  }

  // Process events
  const processedEvents = []
  for (const event of events.items || []) {
    // Skip cancelled events
    if (event.status === 'cancelled') continue

    // Find external attendees
    const userEmail = Session.getActiveUser().getEmail()
    const externalAttendees = (event.attendees || []).filter(
      a => a.email !== userEmail && !a.email.endsWith('@your-domain.com')
    )

    if (externalAttendees.length > 0) {
      processedEvents.push({
        eventId: event.id,
        summary: event.summary,
        start: event.start?.dateTime || event.start?.date,
        end: event.end?.dateTime || event.end?.date,
        attendee: externalAttendees[0],
        hangoutLink: event.hangoutLink,
      })
    }
  }

  // Send to webhook
  if (processedEvents.length > 0) {
    const signature = computeSignature(JSON.stringify(processedEvents), WEBHOOK_SECRET)

    UrlFetchApp.fetch(WEBHOOK_URL, {
      method: 'POST',
      contentType: 'application/json',
      headers: {
        'X-Apps-Script-Signature': signature,
      },
      payload: JSON.stringify({
        calendarId: calendarId,
        events: processedEvents,
        timestamp: new Date().toISOString(),
      }),
    })
  }
}

function computeSignature(payload, secret) {
  const signature = Utilities.computeHmacSha256Signature(payload, secret)
  return Utilities.base64Encode(signature)
}
```

#### 2. Enable Calendar Advanced Service

In Apps Script editor:
1. Click "Services" (+)
2. Add "Google Calendar API" (v3)
3. Save

#### 3. Webhook Handler

```typescript
// api/webhooks/apps-script.ts

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).end()
  }

  // Verify signature
  const signature = req.headers['x-apps-script-signature'] as string
  const payload = JSON.stringify(req.body)
  const expected = computeHmac(payload, process.env.APPS_SCRIPT_SECRET!)

  if (!timingSafeEqual(signature, expected)) {
    return res.status(401).json({ error: 'Invalid signature' })
  }

  // Acknowledge
  res.status(200).json({ ok: true })

  // Process events
  const { events } = req.body

  for (const event of events) {
    setImmediate(async () => {
      await runBriefPipeline({
        source: 'google',
        eventId: event.eventId,
        eventStartTime: new Date(event.start),
        attendeeEmail: event.attendee.email,
        attendeeName: event.attendee.displayName,
        eventName: event.summary,
        joinUrl: event.hangoutLink,
      })
    })
  }
}
```

#### 4. Deployment as Google Workspace Add-on

For multi-user deployment, package as a Workspace Add-on:

```json
// appsscript.json
{
  "timeZone": "America/New_York",
  "dependencies": {
    "enabledAdvancedServices": [
      {
        "userSymbol": "Calendar",
        "serviceId": "calendar",
        "version": "v3"
      }
    ]
  },
  "webapp": {
    "executeAs": "USER_ACCESSING",
    "access": "DOMAIN"
  },
  "addOns": {
    "common": {
      "name": "Meeting Brief Generator",
      "logoUrl": "https://your-app.com/logo.png",
      "homepageTrigger": {
        "runFunction": "showHomepage"
      }
    },
    "calendar": {
      "eventOpenTrigger": {
        "runFunction": "onEventOpen"
      }
    }
  }
}
```

**Pros:**
- No channel expiration management
- Runs in user context (inherent OAuth)
- Can include event data in webhook (no extra API call)
- Simpler for Google Workspace organizations

**Cons:**
- Requires Apps Script deployment per user/organization
- Execution quotas (90 min/day free, 6 hours/day paid)
- Slightly more latency than direct API

**References:**
- [Installable Triggers](https://developers.google.com/apps-script/guides/triggers/installable)
- [CalendarTriggerBuilder](https://developers.google.com/apps-script/reference/script/calendar-trigger-builder)
- [Calendar Service](https://developers.google.com/apps-script/reference/calendar)

---

## Integration Comparison

| Feature | Calendly | Google Calendar API | Apps Script |
|---------|----------|---------------------|-------------|
| Setup complexity | Low | Medium | Medium |
| Multi-tenant | Yes (webhook) | Yes (per-user OAuth) | Yes (per-org deploy) |
| Real-time | Yes | Yes | ~10s delay |
| Form data | Yes (Q&A) | No | No |
| Expiration management | None | Required (7 days) | None |
| Rate limits | Generous | 1M/day | 90 min/day (free) |
| Best for | Dedicated booking pages | General calendar sync | Google Workspace orgs |

---

## Database Schema

### Core Tables

```sql
-- Companies table
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  domain TEXT UNIQUE,
  territory TEXT,           -- City/metro
  state TEXT,               -- State abbreviation
  needs_review BOOLEAN DEFAULT FALSE,
  review_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Meetings table
CREATE TABLE meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  attendee TEXT,
  attendee_email TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  join_url TEXT,
  external_event_id TEXT,   -- Calendly UUID or Google event ID
  source TEXT DEFAULT 'calendly',  -- 'calendly' | 'google' | 'manual'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Meeting brief results
CREATE TABLE meetingbrief_results (
  meeting_id UUID PRIMARY KEY REFERENCES meetings(id),
  attendee_name TEXT,
  attendee_email TEXT,
  company_name TEXT,
  brief_html TEXT,
  citations JSONB,          -- [{url, title}]
  metrics JSONB,            -- {sources_count, generated_ms, news[], red_flags[]}
  sources JSONB,            -- [{url, snippet}]
  slack_notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Research artifacts (debugging)
CREATE TABLE research_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  meeting_id UUID REFERENCES meetings(id),
  artifact_type TEXT,       -- 'inference' | 'harvest' | 'research'
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Question templates (industry-specific)
CREATE TABLE question_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  industry_key TEXT NOT NULL,
  questions TEXT[] NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Google Calendar Tables (if using Option 2)

```sql
-- Watch channels for Google Calendar push notifications
CREATE TABLE google_watch_channels (
  channel_id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  calendar_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  token TEXT NOT NULL,
  expiration TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sync state for incremental sync
CREATE TABLE google_sync_state (
  calendar_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  sync_token TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Track processed events to prevent duplicates
CREATE TABLE processed_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_event_id TEXT UNIQUE,
  calendly_event_id TEXT UNIQUE,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for channel expiration queries
CREATE INDEX idx_channels_expiration ON google_watch_channels(expiration);
```

---

## Environment Variables

```bash
# ===================
# Database
# ===================
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# ===================
# Calendar: Calendly
# ===================
CALENDLY_API_KEY=xxx
CALENDLY_SIGNING_SECRET=xxx

# ===================
# Calendar: Google (if using)
# ===================
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx
GOOGLE_REDIRECT_URI=https://your-app.com/api/auth/callback/google

# ===================
# Calendar: Apps Script (if using)
# ===================
APPS_SCRIPT_SECRET=xxx

# ===================
# AI/LLM
# ===================
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=xxx    # Optional, for Claude
GOOGLE_API_KEY=xxx       # Optional, for Gemini

# ===================
# Research APIs
# ===================
SERPER_API_KEY=xxx
FIRECRAWL_KEY=xxx
HARVEST_API_KEY=xxx

# ===================
# Slack
# ===================
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=xxx
SLACK_BRIEF_CHANNEL_ID=C...
SLACK_CEO_USER_ID=U...

# ===================
# App Config
# ===================
PUBLIC_BASE_URL=https://brief.your-app.com
SLACK_ENABLED=true
```

---

## Deployment

### Vercel Configuration

```json
// vercel.json
{
  "version": 2,
  "functions": {
    "api/**/*.ts": {
      "maxDuration": 300
    }
  },
  "crons": [
    {
      "path": "/api/internal/refresh-watch",
      "schedule": "0 * * * *"
    }
  ]
}
```

### Package Dependencies

```json
// package.json (partial)
{
  "dependencies": {
    "@slack/web-api": "^7.1.0",
    "@supabase/supabase-js": "^2.39.0",
    "googleapis": "^130.0.0",
    "openai": "^4.20.0",
    "@anthropic-ai/sdk": "^0.10.0",
    "axios": "^1.6.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@vercel/node": "^3.0.0",
    "typescript": "^5.6.0"
  }
}
```

---

## Migration Steps

### From OutSearched to /brief

1. **Initialize repo**
   ```bash
   mkdir /brief && cd /brief
   pnpm init
   pnpm add -D typescript @vercel/node
   ```

2. **Copy core files** (see file structure above)

3. **Refactor calendar adapter**
   - Create abstract `CalendarAdapter` interface
   - Implement `CalendlyAdapter` and `GoogleCalendarAdapter`
   - Update pipeline to use adapter pattern

4. **Update imports**
   - Change `../` paths to new structure
   - Remove OutSearched-specific dependencies (mandate scoring, etc.)

5. **Simplify for standalone use**
   - Remove Notion integration (or make optional)
   - Remove Smartlead integration (or make optional)
   - Remove mandate scoring (or make optional)

6. **Test**
   - Unit tests for each step
   - Integration test with mock calendar events

7. **Deploy**
   - Create Vercel project
   - Configure environment variables
   - Set up Calendly webhook (or Google OAuth)

---

## Next Steps

1. Review this plan and confirm scope
2. Decide which calendar integrations to include
3. Begin Phase 1: Core Infrastructure
4. Iterate through remaining phases

---

## Sources

- [Google Calendar Push Notifications](https://developers.google.com/workspace/calendar/api/guides/push)
- [Google Apps Script Installable Triggers](https://developers.google.com/apps-script/guides/triggers/installable)
- [CalendarTriggerBuilder Reference](https://developers.google.com/apps-script/reference/script/calendar-trigger-builder)
- [Stateful - Google Calendar Webhooks](https://stateful.com/blog/google-calendar-webhooks)
- [CalendHub Webhook Guide](https://calendhub.com/blog/calendar-webhook-integration-developer-guide-2025/)
