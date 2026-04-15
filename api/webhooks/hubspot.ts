import type { VercelRequest, VercelResponse } from '@vercel/node';
import { validateHubSpotSignature, runHubSpotPipeline } from '../../src/pipeline/orchestrator.js';
import { fetchContact, fetchRecentMeetingForContact, findExistingBriefNote } from '../../src/integrations/hubspot/client.js';
import type { HubSpotWebhookPayload } from '../../src/integrations/hubspot/types.js';
import type { HubSpotEventData } from '../../src/pipeline/types.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const requestId = crypto.randomUUID().slice(0, 8);

  // Validate signature if client secret is configured
  const clientSecret = process.env.HUBSPOT_CLIENT_SECRET;
  if (clientSecret) {
    const signature = req.headers['x-hubspot-signature-v3'] as string;
    const timestamp = req.headers['x-hubspot-request-timestamp'] as string;

    if (!signature || !timestamp) {
      console.error(`[hubspot:${requestId}] Missing signature or timestamp headers`);
      return res.status(401).json({ error: 'Missing signature headers' });
    }

    // Reject requests older than 5 minutes
    const age = Date.now() - Number(timestamp);
    if (age > 5 * 60 * 1000) {
      console.error(`[hubspot:${requestId}] Request too old: ${age}ms`);
      return res.status(401).json({ error: 'Request expired' });
    }

    const rawBody = JSON.stringify(req.body);
    const url = `https://${req.headers.host}${req.url}`;
    const valid = validateHubSpotSignature(clientSecret, 'POST', url, rawBody, timestamp, signature);

    if (!valid) {
      console.error(`[hubspot:${requestId}] Invalid HubSpot signature`);
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  // Accept immediately, process async
  res.status(202).json({ ok: true, requestId });

  setImmediate(async () => {
    try {
      const payload = req.body as HubSpotWebhookPayload;
      const contactId = String(payload.objectId);
      console.log(`[hubspot:${requestId}] Processing webhook for contact ${contactId}`);

      // Fetch contact details from HubSpot
      const contact = await fetchContact(contactId);
      const email = contact.properties.email;
      if (!email) {
        console.warn(`[hubspot:${requestId}] Contact ${contactId} has no email, skipping`);
        return;
      }

      // Fetch the most recent meeting for this contact
      const meeting = await fetchRecentMeetingForContact(contactId);
      if (!meeting) {
        console.warn(`[hubspot:${requestId}] No meeting found for contact ${contactId}, skipping`);
        return;
      }

      // Dedup: check if we already created a brief note for this meeting
      const alreadyExists = await findExistingBriefNote(contactId, meeting.id);
      if (alreadyExists) {
        console.log(`[hubspot:${requestId}] Brief already exists for meeting ${meeting.id} on contact ${contactId}, skipping`);
        return;
      }

      // Build normalized event data
      const eventData: HubSpotEventData = {
        contactId,
        meetingId: meeting.id,
        attendeeEmail: email,
        attendeeName: [contact.properties.firstname, contact.properties.lastname].filter(Boolean).join(' ') || undefined,
        companyName: contact.properties.company || undefined,
        companyDomain: contact.properties.domain || undefined,
        meetingTitle: meeting.properties.hs_meeting_title || undefined,
        meetingStartTime: meeting.properties.hs_meeting_start_time || undefined,
        meetingEndTime: meeting.properties.hs_meeting_end_time || undefined,
        conferenceLink: meeting.properties.hs_meeting_external_url || undefined,
      };

      // Run the pipeline
      const result = await runHubSpotPipeline(eventData, requestId);
      console.log(`[hubspot:${requestId}] Pipeline complete`, result);
    } catch (e) {
      console.error(`[hubspot:${requestId}] Pipeline error`, e);
    }
  });
}
