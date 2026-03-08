import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'node:crypto';
import { validateCalendlySignature, runCalendlyPipeline } from '../../src/pipeline/orchestrator.js';
import { eventByUri } from '../../src/integrations/calendly/client.js';
import { FLAGS } from '../../src/config/env.js';
import { sendOps } from '../../src/integrations/slack/client.js';

function generateRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}

async function readRawBody(req: VercelRequest): Promise<string> {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  if (typeof req.body === 'object') return JSON.stringify(req.body);
  return '';
}

// Validate Calendly event type
function validateEventType(body: any): { valid: boolean; eventType: string; reason: string } {
  const eventType = body?.event || 'unknown';
  const validTypes = ['invitee.created', 'invitee_no_show.created'];
  const ignoredTypes = ['invitee.canceled', 'routing_form_submission.created'];

  if (validTypes.includes(eventType)) {
    return { valid: true, eventType, reason: 'accepted' };
  }
  if (ignoredTypes.includes(eventType)) {
    return { valid: false, eventType, reason: 'ignored' };
  }
  return { valid: false, eventType, reason: 'unknown' };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const requestId = generateRequestId();
  console.log(`[Calendly:${requestId}] Webhook received`);

  if (req.method !== 'POST') {
    console.log(`[Calendly:${requestId}] Rejected: wrong method ${req.method}`);
    res.status(405).json({ ok: false, error: 'method_not_allowed', requestId });
    return;
  }

  const raw = await readRawBody(req);
  const sig = (req.headers['calendly-webhook-signature'] as string) ||
              (req.headers['Calendly-Webhook-Signature'] as string) ||
              (req.headers['calendly-signature'] as string);

  // Parse body
  let body: any = {};
  try {
    body = typeof req.body === 'object' && req.body !== null ? req.body : JSON.parse(raw);
  } catch {
    body = {};
  }

  let signatureOk = validateCalendlySignature(raw, sig);

  // Try normalized JSON if signature fails
  if (!signatureOk && body && typeof body === 'object') {
    try {
      const normalized = JSON.stringify(body);
      signatureOk = validateCalendlySignature(normalized, sig);
    } catch {}
  }

  // Fallback: verify via Calendly API
  if (!signatureOk) {
    const evUuid = body?.payload?.event?.uuid as string | undefined;
    let verified = false;
    if (evUuid && process.env.CALENDLY_API_KEY) {
      try {
        const ev = await eventByUri(`https://api.calendly.com/scheduled_events/${evUuid}`);
        verified = !!(ev && ev.resource && ev.resource.uri);
      } catch {}
    }
    if (!verified) {
      console.log(`[Calendly:${requestId}] Rejected: invalid signature`);
      if (FLAGS.slackEnabled) {
        try {
          await sendOps('Calendly webhook: invalid signature', [
            { type: 'section', text: { type: 'mrkdwn', text: `Rejecting Calendly webhook due to invalid signature (${requestId})` } }
          ]);
        } catch {}
      }
      res.status(401).json({ ok: false, error: 'invalid_signature', requestId });
      return;
    }
    if (FLAGS.slackEnabled) {
      try {
        await sendOps('Calendly webhook: accepted via API verification (signature mismatch)');
      } catch {}
    }
  }

  // Event type validation
  const eventValidation = validateEventType(body);
  console.log(`[Calendly:${requestId}] Event type: ${eventValidation.eventType}, valid: ${eventValidation.valid}, reason: ${eventValidation.reason}`);

  if (!eventValidation.valid) {
    if (eventValidation.reason === 'ignored') {
      console.log(`[Calendly:${requestId}] Ignoring event type: ${eventValidation.eventType}`);
      res.status(200).json({ ok: true, skipped: true, reason: 'event_type_ignored', requestId });
      return;
    }
    console.log(`[Calendly:${requestId}] Rejected unknown event type: ${eventValidation.eventType}`);
    res.status(400).json({ ok: false, error: 'unknown_event_type', eventType: eventValidation.eventType, requestId });
    return;
  }

  // Acknowledge quickly
  console.log(`[Calendly:${requestId}] Processing event: ${eventValidation.eventType}`);
  res.status(202).json({ ok: true, requestId });

  // Continue processing without blocking
  setImmediate(async () => {
    try {
      await runCalendlyPipeline(body, requestId);
      console.log(`[Calendly:${requestId}] Pipeline completed`);
    } catch (e) {
      console.error(`[Calendly:${requestId}] Pipeline error:`, e);
    }
  });
}
