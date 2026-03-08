import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'node:crypto';
import { runGoogleCalendarPipeline } from '../../src/pipeline/orchestrator.js';
import type { GoogleCalendarEvent } from '../../src/pipeline/types.js';

function generateRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}

/**
 * Verify HMAC signature from Apps Script
 */
function verifySignature(payload: string, signature: string): boolean {
  const secret = process.env.APPS_SCRIPT_SECRET;
  if (!secret || !signature) return false;

  try {
    const expected = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('base64');

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
}

/**
 * Handler for Google Apps Script calendar notifications
 *
 * Apps Script sends events directly (unlike API push notifications)
 * with the event data included in the payload.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const requestId = generateRequestId();
  console.log(`[AppsScript:${requestId}] Webhook received`);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify signature
  const signature = req.headers['x-apps-script-signature'] as string;
  const userEmail = req.headers['x-apps-script-user'] as string;
  const payload = JSON.stringify(req.body);

  if (!verifySignature(payload, signature)) {
    console.error(`[AppsScript:${requestId}] Invalid signature from:`, userEmail);
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const { events, calendarId, timestamp } = req.body;

  console.log(`[AppsScript:${requestId}] Received ${events?.length || 0} events from ${calendarId}`);

  // Acknowledge
  res.status(202).json({ ok: true, received: events?.length || 0, requestId });

  // Process events
  for (const event of events || []) {
    setImmediate(async () => {
      try {
        const googleEvent: GoogleCalendarEvent = {
          eventId: event.eventId,
          summary: event.summary,
          start: event.start,
          end: event.end,
          attendee: {
            email: event.attendee?.email,
            name: event.attendee?.name || event.attendee?.displayName,
          },
          hangoutLink: event.hangoutLink,
          conferenceLink: event.conferenceLink,
        };

        await runGoogleCalendarPipeline(googleEvent, requestId);
        console.log(`[AppsScript:${requestId}] Pipeline completed for event:`, event.eventId);
      } catch (e) {
        console.error(`[AppsScript:${requestId}] Pipeline error for event:`, event.eventId, e);
      }
    });
  }
}
