import crypto from 'node:crypto';
import { ENV } from '../config/env.js';
import {
  type PipelineContext,
  type CalendlyWebhookPayload,
  type GoogleCalendarEvent,
} from './types.js';
import {
  fetchEventDetails,
  parseFormInputs,
  inferDomainIndustry,
  upsertCompanyMeeting,
  fetchQuestionTemplates,
  buildOrgName,
  generateMeetingBrief,
  rewriteQuestions,
  persistBrief,
  createBriefUrl,
  sendSlackNotifications,
} from './steps.js';

/**
 * Validate Calendly webhook signature
 */
export function validateCalendlySignature(rawBody: string, signatureHeader?: string): boolean {
  if (!signatureHeader) return false;
  try {
    const sec = (ENV.CALENDLY_SIGNING_SECRET || '').toString();
    const hHex = crypto.createHmac('sha256', sec).update(rawBody).digest('hex');
    const hB64 = crypto.createHmac('sha256', sec).update(rawBody).digest('base64');
    const raw = (signatureHeader || '').toString().trim();

    // Accept common formats
    const mSha = /sha256=([a-f0-9]+)/i.exec(raw);
    const mV1 = /v1=([a-f0-9]+)/i.exec(raw);
    const extracted = mSha?.[1] || mV1?.[1] || raw.replace(/^sha256=/i, '').trim();

    if (extracted && extracted.length >= 20) {
      return timingSafeEq(extracted.toLowerCase(), hHex.toLowerCase());
    }
    if (timingSafeEq(raw, hB64)) return true;
    if (timingSafeEq(raw.toLowerCase(), hHex.toLowerCase())) return true;
    return false;
  } catch {
    return false;
  }
}

function timingSafeEq(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

/**
 * Create a simple pipeline logger
 */
function createLogger(prefix: string, requestId?: string) {
  const id = requestId || crypto.randomUUID().slice(0, 8);
  return {
    info: (msg: string) => console.log(`[${prefix}:${id}] ${msg}`),
    warn: (msg: string, extra?: unknown) => console.warn(`[${prefix}:${id}] ${msg}`, extra || ''),
    error: (context: string, error: unknown, extra?: unknown) => console.error(`[${prefix}:${id}] ${context}`, error, extra || ''),
  };
}

/**
 * Run the prebrief pipeline for a Calendly event
 */
export async function runCalendlyPipeline(payload: CalendlyWebhookPayload, requestId?: string) {
  const log = createLogger('Calendly', requestId);

  let ctx: PipelineContext = {
    source: 'calendly',
    calendlyPayload: payload,
    requestId,
    log,
  };

  // Step 1: Fetch event details
  ctx = await fetchEventDetails(ctx);

  // Skip cancelled events
  if (ctx.eventDetails?.status === 'canceled' || ctx.eventDetails?.status === 'cancelled') {
    console.log(`Skipping cancelled event ${ctx.eventUuid}`);
    return { skipped: true, reason: 'event_cancelled', event_id: ctx.eventUuid };
  }

  // Step 2: Parse form inputs
  ctx = parseFormInputs(ctx);

  // Step 3: Infer domain and industry
  ctx = await inferDomainIndustry(ctx);

  // Step 4: Upsert company and meeting
  ctx = await upsertCompanyMeeting(ctx);

  // Step 5: Fetch question templates
  ctx = await fetchQuestionTemplates(ctx);

  // Step 6: Build org name
  ctx = await buildOrgName(ctx);

  // Step 7: Generate meeting brief
  ctx = await generateMeetingBrief(ctx);

  // Step 8: Rewrite questions
  ctx = await rewriteQuestions(ctx);

  // Step 9: Persist brief
  ctx = await persistBrief(ctx);

  // Step 10: Create brief URL
  ctx = await createBriefUrl(ctx);

  // Step 11: Send Slack notifications
  ctx = await sendSlackNotifications(ctx);

  return {
    meeting_id: ctx.meetingId,
    company_id: ctx.companyId,
    industry_key: ctx.industryKey,
    linkUrl: ctx.linkUrl,
  };
}

/**
 * Run the prebrief pipeline for a Google Calendar event
 */
export async function runGoogleCalendarPipeline(event: GoogleCalendarEvent, requestId?: string) {
  const log = createLogger('GoogleCalendar', requestId);

  let ctx: PipelineContext = {
    source: 'google',
    googleEvent: event,
    requestId,
    log,
  };

  // Step 1: Parse event details (for Google, this normalizes the event)
  ctx = await fetchEventDetails(ctx);

  // Step 2: Parse form inputs (for Google, extracts territory from email)
  ctx = parseFormInputs(ctx);

  // Step 3: Infer domain and industry
  ctx = await inferDomainIndustry(ctx);

  // Step 4: Upsert company and meeting
  ctx = await upsertCompanyMeeting(ctx);

  // Step 5: Fetch question templates
  ctx = await fetchQuestionTemplates(ctx);

  // Step 6: Build org name
  ctx = await buildOrgName(ctx);

  // Step 7: Generate meeting brief
  ctx = await generateMeetingBrief(ctx);

  // Step 8: Rewrite questions
  ctx = await rewriteQuestions(ctx);

  // Step 9: Persist brief
  ctx = await persistBrief(ctx);

  // Step 10: Create brief URL
  ctx = await createBriefUrl(ctx);

  // Step 11: Send Slack notifications
  ctx = await sendSlackNotifications(ctx);

  return {
    meeting_id: ctx.meetingId,
    company_id: ctx.companyId,
    industry_key: ctx.industryKey,
    linkUrl: ctx.linkUrl,
  };
}
