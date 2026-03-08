# Google Calendar Integration - Technical Reference

> Detailed implementation guide for connecting meeting briefs to Google Calendar

## Overview

This document provides step-by-step implementation details for integrating Google Calendar as an event source for the meeting brief pipeline. There are two primary approaches:

1. **Google Calendar API Push Notifications** - Direct API integration
2. **Google Apps Script** - Workspace-native automation

---

## Approach 1: Google Calendar API Push Notifications

### How Push Notifications Work

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        PUSH NOTIFICATION FLOW                                │
└─────────────────────────────────────────────────────────────────────────────┘

1. REGISTRATION
   ┌──────────┐         POST /events/watch           ┌──────────────┐
   │ Your App │ ────────────────────────────────────▶│ Google API   │
   │          │◀──── { resourceId, expiration } ─────│              │
   └──────────┘                                      └──────────────┘

2. NOTIFICATION (when calendar changes)
   ┌──────────────┐      POST (with headers only)    ┌──────────┐
   │ Google       │ ────────────────────────────────▶│ Your App │
   │ Calendar API │     X-Goog-Resource-State:       │ Webhook  │
   └──────────────┘     X-Goog-Channel-ID:           └──────────┘

3. SYNC (your app fetches changes)
   ┌──────────┐         GET /events?syncToken=...    ┌──────────────┐
   │ Your App │ ────────────────────────────────────▶│ Google API   │
   │          │◀──── { items: [...], nextSyncToken } │              │
   └──────────┘                                      └──────────────┘
```

### Important Limitations

| Limitation | Description | Workaround |
|------------|-------------|------------|
| No event data in notification | Push only signals "something changed" | Must call Events.list with syncToken |
| 7-day expiration | Channels expire after ~1 week | Cron job to renew channels |
| HTTPS required | Webhook URL must use valid SSL | Use Vercel/production URL |
| No localhost | Can't test locally with real notifications | Use ngrok or mock notifications |

---

### Step 1: Google Cloud Project Setup

#### 1.1 Create Project

```bash
# Via gcloud CLI
gcloud projects create brief-calendar --name="Brief Calendar"
gcloud config set project brief-calendar
```

Or via [Google Cloud Console](https://console.cloud.google.com/):
1. Click "New Project"
2. Name: "Brief Calendar"
3. Click "Create"

#### 1.2 Enable Calendar API

```bash
gcloud services enable calendar-json.googleapis.com
```

Or in Console:
1. APIs & Services → Library
2. Search "Google Calendar API"
3. Click "Enable"

#### 1.3 Create OAuth Credentials

1. APIs & Services → Credentials
2. Create Credentials → OAuth client ID
3. Application type: "Web application"
4. Name: "Brief Calendar Web"
5. Authorized redirect URIs:
   - `https://your-app.com/api/auth/callback/google`
   - `http://localhost:3000/api/auth/callback/google` (dev)
6. Save Client ID and Client Secret

#### 1.4 Configure OAuth Consent Screen

1. OAuth consent screen → External (or Internal for Workspace)
2. App name: "Meeting Brief Generator"
3. Support email: your-email@domain.com
4. Scopes: Add these two:
   - `https://www.googleapis.com/auth/calendar.readonly`
   - `https://www.googleapis.com/auth/calendar.events.readonly`
5. Test users: Add your email (for testing)

---

### Step 2: OAuth Implementation

#### 2.1 Install Dependencies

```bash
pnpm add googleapis google-auth-library
```

#### 2.2 OAuth Client Setup

```typescript
// src/calendar/google/auth.ts

import { OAuth2Client } from 'google-auth-library'
import { google } from 'googleapis'

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
]

export function createOAuth2Client(): OAuth2Client {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  )
}

export function getAuthUrl(state?: string): string {
  const client = createOAuth2Client()
  return client.generateAuthUrl({
    access_type: 'offline', // Get refresh token
    scope: SCOPES,
    prompt: 'consent', // Force consent to get refresh token
    state,
  })
}

export async function exchangeCodeForTokens(code: string) {
  const client = createOAuth2Client()
  const { tokens } = await client.getToken(code)
  return tokens
}

export function getAuthenticatedClient(tokens: {
  access_token: string
  refresh_token?: string
}): OAuth2Client {
  const client = createOAuth2Client()
  client.setCredentials(tokens)
  return client
}
```

#### 2.3 OAuth Flow Endpoints

```typescript
// api/auth/google/login.ts - Initiate OAuth flow

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const state = crypto.randomUUID() // Store in session/cookie for CSRF protection

  const authUrl = getAuthUrl(state)
  res.redirect(authUrl)
}
```

```typescript
// api/auth/callback/google.ts - Handle OAuth callback

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { code, state, error } = req.query

  if (error) {
    return res.redirect('/setup?error=' + error)
  }

  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Missing code' })
  }

  // TODO: Verify state matches stored value (CSRF protection)

  // Exchange code for tokens
  const tokens = await exchangeCodeForTokens(code)

  // Get user info
  const client = getAuthenticatedClient(tokens)
  const calendar = google.calendar({ version: 'v3', auth: client })
  const calendarList = await calendar.calendarList.list()
  const primaryCalendar = calendarList.data.items?.find(c => c.primary)

  // Store tokens in database
  await db.upsert('google_oauth_tokens', {
    user_email: primaryCalendar?.id,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date,
    updated_at: new Date(),
  })

  // Register watch channel
  await registerWatchChannel(tokens, primaryCalendar?.id!)

  res.redirect('/setup?success=true')
}
```

---

### Step 3: Watch Channel Registration

```typescript
// src/calendar/google/watch.ts

import { google } from 'googleapis'
import { getAuthenticatedClient } from './auth'
import { db } from '../../integrations/supabase/client'

export async function registerWatchChannel(
  tokens: { access_token: string; refresh_token?: string },
  calendarId: string
): Promise<{
  channelId: string
  resourceId: string
  expiration: Date
}> {
  const auth = getAuthenticatedClient(tokens)
  const calendar = google.calendar({ version: 'v3', auth })

  // Generate unique channel ID and token
  const channelId = crypto.randomUUID()
  const channelToken = crypto.randomBytes(32).toString('hex')

  // Calculate expiration (max 7 days, we use 6 for safety)
  const expiration = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000)

  const response = await calendar.events.watch({
    calendarId,
    requestBody: {
      id: channelId,
      type: 'web_hook',
      address: `${process.env.PUBLIC_BASE_URL}/api/webhooks/google-calendar`,
      token: channelToken,
      expiration: String(expiration.getTime()),
    },
  })

  // Store channel info for renewal and validation
  await db.from('google_watch_channels').insert({
    channel_id: channelId,
    resource_id: response.data.resourceId,
    calendar_id: calendarId,
    token: channelToken,
    expiration: expiration.toISOString(),
  })

  // Initialize sync state (will trigger full sync on first notification)
  await db.from('google_sync_state').upsert({
    calendar_id: calendarId,
    sync_token: null, // First sync will be full
    updated_at: new Date().toISOString(),
  })

  return {
    channelId,
    resourceId: response.data.resourceId!,
    expiration,
  }
}

export async function stopWatchChannel(channelId: string, resourceId: string) {
  const channel = await db
    .from('google_watch_channels')
    .select('*')
    .eq('channel_id', channelId)
    .single()

  if (!channel.data) return

  const tokens = await getTokensForCalendar(channel.data.calendar_id)
  const auth = getAuthenticatedClient(tokens)
  const calendar = google.calendar({ version: 'v3', auth })

  await calendar.channels.stop({
    requestBody: {
      id: channelId,
      resourceId,
    },
  })

  await db
    .from('google_watch_channels')
    .delete()
    .eq('channel_id', channelId)
}
```

---

### Step 4: Webhook Handler

```typescript
// api/webhooks/google-calendar.ts

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { performIncrementalSync } from '../../src/calendar/google/sync'
import { db } from '../../src/integrations/supabase/client'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Extract Google headers
  const headers = {
    channelId: req.headers['x-goog-channel-id'] as string,
    channelToken: req.headers['x-goog-channel-token'] as string,
    resourceId: req.headers['x-goog-resource-id'] as string,
    resourceState: req.headers['x-goog-resource-state'] as string,
    messageNumber: req.headers['x-goog-message-number'] as string,
  }

  console.log('[GoogleCalendar] Notification received:', {
    channelId: headers.channelId,
    resourceState: headers.resourceState,
    messageNumber: headers.messageNumber,
  })

  // Validate channel exists and token matches
  const { data: channel, error } = await db
    .from('google_watch_channels')
    .select('*')
    .eq('channel_id', headers.channelId)
    .single()

  if (error || !channel) {
    console.error('[GoogleCalendar] Unknown channel:', headers.channelId)
    return res.status(404).json({ error: 'Channel not found' })
  }

  if (channel.token !== headers.channelToken) {
    console.error('[GoogleCalendar] Token mismatch for channel:', headers.channelId)
    return res.status(401).json({ error: 'Invalid token' })
  }

  // Acknowledge immediately (Google expects fast response)
  res.status(200).end()

  // Handle sync message (initial confirmation)
  if (headers.resourceState === 'sync') {
    console.log('[GoogleCalendar] Watch channel confirmed:', headers.channelId)
    return
  }

  // Handle actual changes
  if (headers.resourceState === 'exists') {
    // Process async to not block
    setImmediate(async () => {
      try {
        await performIncrementalSync(channel.calendar_id)
        console.log('[GoogleCalendar] Sync completed for:', channel.calendar_id)
      } catch (e) {
        console.error('[GoogleCalendar] Sync error:', e)
      }
    })
  }
}
```

---

### Step 5: Incremental Sync

```typescript
// src/calendar/google/sync.ts

import { google, calendar_v3 } from 'googleapis'
import { getAuthenticatedClient, getTokensForCalendar } from './auth'
import { db } from '../../integrations/supabase/client'
import { runBriefPipeline } from '../../pipeline/orchestrator'

interface SyncResult {
  eventsProcessed: number
  briefsGenerated: number
}

export async function performIncrementalSync(calendarId: string): Promise<SyncResult> {
  const tokens = await getTokensForCalendar(calendarId)
  const auth = getAuthenticatedClient(tokens)
  const calendar = google.calendar({ version: 'v3', auth })

  // Get stored sync token
  const { data: syncState } = await db
    .from('google_sync_state')
    .select('sync_token')
    .eq('calendar_id', calendarId)
    .single()

  // Build request params
  const params: calendar_v3.Params$Resource$Events$List = {
    calendarId,
    singleEvents: true,
    orderBy: 'updated',
  }

  if (syncState?.sync_token) {
    // Incremental sync
    params.syncToken = syncState.sync_token
  } else {
    // Full sync - only future events
    params.timeMin = new Date().toISOString()
    params.maxResults = 50
  }

  let response: calendar_v3.Schema$Events
  try {
    const result = await calendar.events.list(params)
    response = result.data
  } catch (e: any) {
    // Handle invalid sync token (requires full sync)
    if (e.code === 410) {
      console.log('[GoogleCalendar] Sync token expired, doing full sync')
      await db
        .from('google_sync_state')
        .update({ sync_token: null })
        .eq('calendar_id', calendarId)
      return performIncrementalSync(calendarId) // Retry with full sync
    }
    throw e
  }

  // Store new sync token
  if (response.nextSyncToken) {
    await db
      .from('google_sync_state')
      .upsert({
        calendar_id: calendarId,
        sync_token: response.nextSyncToken,
        updated_at: new Date().toISOString(),
      })
  }

  // Process events
  let eventsProcessed = 0
  let briefsGenerated = 0

  for (const event of response.items || []) {
    eventsProcessed++

    // Skip cancelled events
    if (event.status === 'cancelled') continue

    // Skip events without start time (all-day events without dateTime)
    if (!event.start?.dateTime) continue

    // Skip past events
    const startTime = new Date(event.start.dateTime)
    if (startTime < new Date()) continue

    // Find external attendees (not the calendar owner)
    const ownerEmail = calendarId
    const externalAttendees = (event.attendees || []).filter(
      a => !a.self && a.email !== ownerEmail && !isInternalEmail(a.email!)
    )

    if (externalAttendees.length === 0) continue

    // Check if we've already processed this event
    const { data: existing } = await db
      .from('processed_events')
      .select('id')
      .eq('google_event_id', event.id)
      .single()

    if (existing) continue

    // Run brief pipeline for first external attendee
    const attendee = externalAttendees[0]

    await runBriefPipeline({
      source: 'google',
      eventId: event.id!,
      eventStartTime: startTime,
      eventEndTime: event.end?.dateTime ? new Date(event.end.dateTime) : undefined,
      eventName: event.summary || 'Meeting',
      attendeeEmail: attendee.email!,
      attendeeName: attendee.displayName,
      joinUrl: event.hangoutLink || event.conferenceData?.entryPoints?.[0]?.uri,
    })

    // Mark as processed
    await db.from('processed_events').insert({
      google_event_id: event.id,
      processed_at: new Date().toISOString(),
    })

    briefsGenerated++
  }

  return { eventsProcessed, briefsGenerated }
}

function isInternalEmail(email: string): boolean {
  const internalDomains = (process.env.INTERNAL_DOMAINS || '').split(',')
  return internalDomains.some(domain => email.endsWith(domain))
}
```

---

### Step 6: Channel Renewal Cron

```typescript
// api/internal/refresh-watch.ts

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { db } from '../../src/integrations/supabase/client'
import { registerWatchChannel, stopWatchChannel } from '../../src/calendar/google/watch'
import { getTokensForCalendar } from '../../src/calendar/google/auth'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Find channels expiring in the next 2 hours
  const twoHoursFromNow = new Date(Date.now() + 2 * 60 * 60 * 1000)

  const { data: expiringChannels, error } = await db
    .from('google_watch_channels')
    .select('*')
    .lt('expiration', twoHoursFromNow.toISOString())

  if (error) {
    console.error('[RefreshWatch] Error fetching channels:', error)
    return res.status(500).json({ error: 'Database error' })
  }

  const results = {
    renewed: 0,
    failed: 0,
    errors: [] as string[],
  }

  for (const channel of expiringChannels || []) {
    try {
      // Stop old channel
      await stopWatchChannel(channel.channel_id, channel.resource_id)

      // Get fresh tokens
      const tokens = await getTokensForCalendar(channel.calendar_id)

      // Create new channel
      await registerWatchChannel(tokens, channel.calendar_id)

      results.renewed++
    } catch (e: any) {
      results.failed++
      results.errors.push(`${channel.calendar_id}: ${e.message}`)
      console.error('[RefreshWatch] Failed to renew:', channel.calendar_id, e)
    }
  }

  console.log('[RefreshWatch] Complete:', results)
  res.status(200).json(results)
}
```

---

## Approach 2: Google Apps Script

### Advantages Over API Push Notifications

| Feature | API Push | Apps Script |
|---------|----------|-------------|
| Channel expiration | Yes (7 days) | No |
| OAuth per user | Required | Built-in |
| Event data in notification | No | Yes |
| Deployment complexity | Lower | Higher (needs Workspace) |
| Execution limits | API quotas | Time-based (90 min/day free) |

---

### Complete Apps Script Implementation

```javascript
// Code.gs

/**
 * Configuration
 */
const CONFIG = {
  WEBHOOK_URL: 'https://your-app.com/api/webhooks/apps-script',
  WEBHOOK_SECRET: PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET'),
  INTERNAL_DOMAINS: ['@your-company.com', '@your-domain.com'],
}

/**
 * Run once to create the calendar trigger
 */
function setupTrigger() {
  // Delete existing triggers
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === 'onCalendarUpdate') {
      ScriptApp.deleteTrigger(trigger)
    }
  })

  // Create new trigger on primary calendar
  const email = Session.getActiveUser().getEmail()
  ScriptApp.newTrigger('onCalendarUpdate')
    .forUserCalendar(email)
    .onEventUpdated()
    .create()

  Logger.log('Trigger created for: ' + email)
}

/**
 * Called when calendar events change
 */
function onCalendarUpdate(e) {
  try {
    const calendarId = e.calendarId
    const props = PropertiesService.getUserProperties()

    // Get sync token (null for first run)
    const syncTokenKey = 'syncToken_' + calendarId
    const syncToken = props.getProperty(syncTokenKey)

    // Fetch changed events
    const options = {
      singleEvents: true,
      orderBy: 'updated',
    }

    if (syncToken) {
      options.syncToken = syncToken
    } else {
      // First sync: only future events
      options.timeMin = new Date().toISOString()
      options.maxResults = 50
    }

    let events
    try {
      events = Calendar.Events.list(calendarId, options)
    } catch (e) {
      if (e.message.includes('Sync token is no longer valid')) {
        // Reset and try again
        props.deleteProperty(syncTokenKey)
        return onCalendarUpdate(e)
      }
      throw e
    }

    // Store new sync token
    if (events.nextSyncToken) {
      props.setProperty(syncTokenKey, events.nextSyncToken)
    }

    // Process events
    const userEmail = Session.getActiveUser().getEmail()
    const eventsToProcess = []

    for (const event of events.items || []) {
      // Skip cancelled events
      if (event.status === 'cancelled') continue

      // Skip events without dateTime (all-day events)
      if (!event.start || !event.start.dateTime) continue

      // Skip past events
      const startTime = new Date(event.start.dateTime)
      if (startTime < new Date()) continue

      // Find external attendees
      const externalAttendees = (event.attendees || []).filter(a => {
        if (a.email === userEmail) return false
        if (a.self) return false
        return !CONFIG.INTERNAL_DOMAINS.some(d => a.email.endsWith(d))
      })

      if (externalAttendees.length === 0) continue

      eventsToProcess.push({
        eventId: event.id,
        summary: event.summary || 'Meeting',
        description: event.description,
        start: event.start.dateTime,
        end: event.end?.dateTime,
        attendee: {
          email: externalAttendees[0].email,
          name: externalAttendees[0].displayName,
          responseStatus: externalAttendees[0].responseStatus,
        },
        organizer: event.organizer?.email,
        hangoutLink: event.hangoutLink,
        conferenceLink: getConferenceLink(event),
        location: event.location,
      })
    }

    // Send to webhook
    if (eventsToProcess.length > 0) {
      sendToWebhook(calendarId, eventsToProcess)
    }

  } catch (e) {
    Logger.log('Error in onCalendarUpdate: ' + e.message)
    console.error(e)
  }
}

/**
 * Extract conference/meeting link from event
 */
function getConferenceLink(event) {
  if (event.hangoutLink) return event.hangoutLink

  const entryPoints = event.conferenceData?.entryPoints
  if (entryPoints && entryPoints.length > 0) {
    const videoEntry = entryPoints.find(e => e.entryPointType === 'video')
    if (videoEntry) return videoEntry.uri
    return entryPoints[0].uri
  }

  return null
}

/**
 * Send events to webhook with HMAC signature
 */
function sendToWebhook(calendarId, events) {
  const payload = {
    source: 'apps_script',
    calendarId: calendarId,
    userEmail: Session.getActiveUser().getEmail(),
    timestamp: new Date().toISOString(),
    events: events,
  }

  const payloadString = JSON.stringify(payload)
  const signature = computeHmacSignature(payloadString)

  const response = UrlFetchApp.fetch(CONFIG.WEBHOOK_URL, {
    method: 'POST',
    contentType: 'application/json',
    headers: {
      'X-Apps-Script-Signature': signature,
      'X-Apps-Script-User': Session.getActiveUser().getEmail(),
    },
    payload: payloadString,
    muteHttpExceptions: true,
  })

  const statusCode = response.getResponseCode()
  if (statusCode !== 200 && statusCode !== 202) {
    Logger.log('Webhook error: ' + statusCode + ' - ' + response.getContentText())
  }
}

/**
 * Compute HMAC-SHA256 signature
 */
function computeHmacSignature(payload) {
  const signature = Utilities.computeHmacSha256Signature(payload, CONFIG.WEBHOOK_SECRET)
  return Utilities.base64Encode(signature)
}

/**
 * Test function - manually trigger sync
 */
function testSync() {
  const email = Session.getActiveUser().getEmail()
  onCalendarUpdate({ calendarId: email })
}

/**
 * View current triggers (for debugging)
 */
function listTriggers() {
  const triggers = ScriptApp.getProjectTriggers()
  triggers.forEach(t => {
    Logger.log('Trigger: ' + t.getHandlerFunction() + ' - ' + t.getTriggerSource())
  })
}
```

### Apps Script Setup Steps

1. **Create Script**
   - Go to [script.google.com](https://script.google.com)
   - New Project
   - Paste the code above

2. **Enable Calendar API**
   - Services (+) → Add "Google Calendar API"

3. **Set Script Properties**
   - Project Settings → Script Properties
   - Add: `WEBHOOK_SECRET` = your-secret-key

4. **Run Setup**
   - Run `setupTrigger()` function
   - Authorize when prompted

5. **Test**
   - Run `testSync()` to verify connection

---

### Apps Script Webhook Handler

```typescript
// api/webhooks/apps-script.ts

import type { VercelRequest, VercelResponse } from '@vercel/node'
import crypto from 'crypto'
import { runBriefPipeline } from '../../src/pipeline/orchestrator'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Verify signature
  const signature = req.headers['x-apps-script-signature'] as string
  const userEmail = req.headers['x-apps-script-user'] as string

  if (!signature) {
    return res.status(401).json({ error: 'Missing signature' })
  }

  const payload = JSON.stringify(req.body)
  const expected = crypto
    .createHmac('sha256', process.env.APPS_SCRIPT_SECRET!)
    .update(payload)
    .digest('base64')

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    console.error('[AppsScript] Invalid signature from:', userEmail)
    return res.status(401).json({ error: 'Invalid signature' })
  }

  // Acknowledge
  res.status(202).json({ ok: true, received: req.body.events?.length || 0 })

  // Process events
  const { events } = req.body

  for (const event of events || []) {
    setImmediate(async () => {
      try {
        await runBriefPipeline({
          source: 'google',
          eventId: event.eventId,
          eventStartTime: new Date(event.start),
          eventEndTime: event.end ? new Date(event.end) : undefined,
          eventName: event.summary,
          attendeeEmail: event.attendee.email,
          attendeeName: event.attendee.name,
          joinUrl: event.conferenceLink || event.hangoutLink,
        })
      } catch (e) {
        console.error('[AppsScript] Pipeline error for event:', event.eventId, e)
      }
    })
  }
}
```

---

## Unified Calendar Adapter

To support both Calendly and Google Calendar, use an adapter pattern:

```typescript
// src/calendar/adapter.ts

export interface CalendarEvent {
  source: 'calendly' | 'google' | 'manual'
  eventId: string
  eventStartTime: Date
  eventEndTime?: Date
  eventName: string
  attendeeEmail: string
  attendeeName?: string
  joinUrl?: string | null
  formData?: Array<{ question: string; answer: string }>
}

export interface CalendarAdapter {
  name: string
  parseWebhook(payload: unknown): CalendarEvent | null
  validateSignature(payload: string, signature: string): boolean
}
```

```typescript
// src/calendar/calendly.ts

import { CalendarAdapter, CalendarEvent } from './adapter'
import crypto from 'crypto'

export class CalendlyAdapter implements CalendarAdapter {
  name = 'calendly'

  validateSignature(payload: string, signature: string): boolean {
    if (!signature || !process.env.CALENDLY_SIGNING_SECRET) {
      return false
    }

    // Calendly uses: t=timestamp,v1=signature format
    const parts = signature.split(',')
    const timestampPart = parts.find(p => p.startsWith('t='))
    const signaturePart = parts.find(p => p.startsWith('v1='))

    if (!timestampPart || !signaturePart) return false

    const timestamp = timestampPart.slice(2)
    const providedSig = signaturePart.slice(3)

    const signedPayload = `${timestamp}.${payload}`
    const expected = crypto
      .createHmac('sha256', process.env.CALENDLY_SIGNING_SECRET)
      .update(signedPayload)
      .digest('hex')

    return crypto.timingSafeEqual(
      Buffer.from(providedSig),
      Buffer.from(expected)
    )
  }

  parseWebhook(payload: any): CalendarEvent | null {
    const inner = payload?.payload
    if (!inner?.event || !inner?.invitee) {
      return null
    }

    return {
      source: 'calendly',
      eventId: inner.event.uuid,
      eventStartTime: new Date(inner.event.start_time),
      eventEndTime: inner.event.end_time ? new Date(inner.event.end_time) : undefined,
      eventName: inner.event.name || 'Meeting',
      attendeeEmail: inner.invitee.email,
      attendeeName: inner.invitee.name,
      joinUrl: inner.event.join_url,
      formData: inner.questions_and_answers?.map((qa: any) => ({
        question: qa.question,
        answer: qa.answer,
      })),
    }
  }
}
```

---

## Testing Guide

### Local Testing with ngrok

```bash
# Start ngrok tunnel
ngrok http 3000

# Use the HTTPS URL for webhook configuration
# https://abc123.ngrok.io/api/webhooks/google-calendar
```

### Mock Notifications

```typescript
// scripts/mock-google-notification.ts

async function sendMockNotification() {
  const response = await fetch('http://localhost:3000/api/webhooks/google-calendar', {
    method: 'POST',
    headers: {
      'x-goog-channel-id': 'test-channel-123',
      'x-goog-channel-token': 'your-test-token',
      'x-goog-resource-id': 'resource-123',
      'x-goog-resource-state': 'exists',
      'x-goog-message-number': '1',
    },
  })

  console.log('Response:', response.status)
}
```

---

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| 401 on webhook | Invalid signature/token | Verify token matches stored value |
| 410 on sync | Sync token expired | Clear token, do full sync |
| No notifications | Channel expired | Check expiration, renew channel |
| Duplicate briefs | Missing dedup check | Check `processed_events` table |
| Rate limited | Too many API calls | Implement backoff, batch requests |

---

## References

- [Google Calendar API Push Notifications](https://developers.google.com/workspace/calendar/api/guides/push)
- [Google Apps Script Triggers](https://developers.google.com/apps-script/guides/triggers/installable)
- [CalendarTriggerBuilder](https://developers.google.com/apps-script/reference/script/calendar-trigger-builder)
- [Stateful - Google Calendar Webhooks](https://stateful.com/blog/google-calendar-webhooks)
- [GitHub - Google Calendar Webhook POC](https://github.com/frlncr-app/google-calendar-events-webhook-poc)
