import crypto from 'node:crypto';
import type { PipelineContext, HubSpotEventData } from './types.js';
import {
  extractEventDetails,
  inferDomainIndustry,
  fetchQuestionTemplates,
  buildOrgName,
  generateMeetingBrief,
  rewriteQuestions,
  persistToHubSpot,
  sendSlackNotification,
} from './steps.js';

/**
 * Validate HubSpot webhook signature (v3)
 * https://developers.hubspot.com/docs/api/webhooks#security
 */
export function validateHubSpotSignature(
  clientSecret: string,
  method: string,
  url: string,
  rawBody: string,
  timestamp: string,
  signatureHeader: string,
): boolean {
  try {
    const sourceString = method + url + rawBody + timestamp;
    const hash = crypto.createHmac('sha256', clientSecret).update(sourceString).digest('base64');
    const ba = Buffer.from(hash);
    const bb = Buffer.from(signatureHeader);
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
 * Run the prebrief pipeline for a HubSpot-triggered event
 */
export async function runHubSpotPipeline(event: HubSpotEventData, requestId?: string) {
  const log = createLogger('HubSpot', requestId);

  let ctx: PipelineContext = {
    source: 'hubspot',
    hubspotEvent: event,
    requestId,
    log,
  };

  // Step 1: Extract event details from HubSpot data
  ctx = extractEventDetails(ctx);
  log.info(`Processing meeting for ${ctx.attendeeEmail} (${ctx.companyName || 'unknown company'})`);

  // Step 2: Infer domain and industry
  ctx = await inferDomainIndustry(ctx);

  // Step 3: Fetch question templates
  ctx = fetchQuestionTemplates(ctx);

  // Step 4: Build org name
  ctx = buildOrgName(ctx);

  // Step 5: Generate meeting brief
  ctx = await generateMeetingBrief(ctx);

  // Step 6: Rewrite questions
  ctx = await rewriteQuestions(ctx);

  // Step 7: Persist to HubSpot (create Note on contact)
  ctx = await persistToHubSpot(ctx);

  // Step 8: Send Slack notification
  ctx = await sendSlackNotification(ctx);

  return {
    hubspotContactId: ctx.hubspotContactId,
    hubspotMeetingId: ctx.hubspotMeetingId,
    hubspotNoteId: ctx.hubspotNoteId,
    industryKey: ctx.industryKey,
    orgName: ctx.orgName,
  };
}
