import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'node:crypto';
import { runGoogleCalendarPipeline } from '../../src/pipeline/orchestrator.js';
import { supabaseAdmin } from '../../src/integrations/supabase/client.js';

function generateRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}

/**
 * Handler for Google Calendar push notifications
 *
 * Google sends POST requests with headers:
 * - X-Goog-Channel-ID: The channel ID you specified when creating the watch
 * - X-Goog-Channel-Token: The token you specified
 * - X-Goog-Resource-State: 'sync' | 'exists' | 'not_exists'
 * - X-Goog-Resource-ID: The resource ID
 * - X-Goog-Message-Number: Incrementing message number
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const requestId = generateRequestId();
  console.log(`[GoogleCalendar:${requestId}] Notification received`);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Extract Google headers
  const headers = {
    channelId: req.headers['x-goog-channel-id'] as string,
    channelToken: req.headers['x-goog-channel-token'] as string,
    resourceId: req.headers['x-goog-resource-id'] as string,
    resourceState: req.headers['x-goog-resource-state'] as string,
    messageNumber: req.headers['x-goog-message-number'] as string,
  };

  console.log(`[GoogleCalendar:${requestId}] Headers:`, {
    channelId: headers.channelId,
    resourceState: headers.resourceState,
    messageNumber: headers.messageNumber,
  });

  // Validate channel exists and token matches
  const { data: channel, error } = await supabaseAdmin
    .from('google_watch_channels')
    .select('*')
    .eq('channel_id', headers.channelId)
    .single();

  if (error || !channel) {
    console.error(`[GoogleCalendar:${requestId}] Unknown channel:`, headers.channelId);
    return res.status(404).json({ error: 'Channel not found' });
  }

  if (channel.token !== headers.channelToken) {
    console.error(`[GoogleCalendar:${requestId}] Token mismatch for channel:`, headers.channelId);
    return res.status(401).json({ error: 'Invalid token' });
  }

  // Acknowledge immediately
  res.status(200).end();

  // Handle sync message (initial confirmation)
  if (headers.resourceState === 'sync') {
    console.log(`[GoogleCalendar:${requestId}] Watch channel confirmed:`, headers.channelId);
    return;
  }

  // Handle actual changes
  if (headers.resourceState === 'exists') {
    setImmediate(async () => {
      try {
        await performIncrementalSync(channel.calendar_id, requestId);
        console.log(`[GoogleCalendar:${requestId}] Sync completed for:`, channel.calendar_id);
      } catch (e) {
        console.error(`[GoogleCalendar:${requestId}] Sync error:`, e);
      }
    });
  }
}

/**
 * Perform incremental sync for a calendar
 * This is a placeholder - implement with googleapis library
 */
async function performIncrementalSync(calendarId: string, requestId: string) {
  // In production, you would:
  // 1. Get stored sync token from google_sync_state
  // 2. Call Calendar.events.list with syncToken
  // 3. Store new nextSyncToken
  // 4. Process changed events

  console.log(`[GoogleCalendar:${requestId}] Would sync calendar:`, calendarId);

  // Placeholder: For now, just log
  // Implement with googleapis in production:
  //
  // const { data: syncState } = await supabaseAdmin
  //   .from('google_sync_state')
  //   .select('sync_token')
  //   .eq('calendar_id', calendarId)
  //   .single();
  //
  // const events = await calendar.events.list({
  //   calendarId,
  //   syncToken: syncState?.sync_token,
  //   singleEvents: true,
  // });
  //
  // for (const event of events.data.items || []) {
  //   // Filter external attendees
  //   // Check if already processed
  //   // Run pipeline
  //   await runGoogleCalendarPipeline({
  //     eventId: event.id,
  //     summary: event.summary,
  //     start: event.start.dateTime,
  //     end: event.end?.dateTime,
  //     attendee: { email: '...', name: '...' },
  //     hangoutLink: event.hangoutLink,
  //   }, requestId);
  // }
}
