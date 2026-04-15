/**
 * Composable steps for the prebrief pipeline
 * Each step is a pure function that takes context and returns updated context
 */

import { ENV, FLAGS } from '../config/env.js';
import { extractTerritory } from '../utils/territory.js';
import { briefRewrite } from '../ai/briefRewrite.js';
import { humanizeOrgFromDomain, normalizeDomain, isFreeEmailDomain } from '../utils/domain.js';
import { getQuestionsForIndustry } from '../data/questionTemplates.js';
import { createNote } from '../integrations/hubspot/client.js';
import { sendPrebrief } from '../integrations/slack/sendPrebrief.js';
import type { PipelineContext } from './types.js';

// ============================================================
// STEP 1: Extract Event Details from HubSpot data
// ============================================================

export function extractEventDetails(ctx: PipelineContext): PipelineContext {
  const ev = ctx.hubspotEvent;
  if (!ev) {
    ctx.log.warn('No HubSpot event data available');
    return ctx;
  }

  return {
    ...ctx,
    eventDetails: {
      uuid: ev.meetingId,
      start_time: ev.meetingStartTime,
      end_time: ev.meetingEndTime,
      name: ev.meetingTitle,
      status: 'active',
      join_url: ev.conferenceLink,
    },
    hubspotContactId: ev.contactId,
    hubspotMeetingId: ev.meetingId,
    attendeeEmail: ev.attendeeEmail,
    attendeeName: ev.attendeeName,
    companyName: ev.companyName,
  };
}

// ============================================================
// STEP 2: Infer Domain and Industry
// ============================================================

export async function inferDomainIndustry(ctx: PipelineContext): Promise<PipelineContext> {
  const emailDomain = ctx.attendeeEmail?.split('@')[1] || '';

  // Prefer company domain from HubSpot, fall back to email domain
  let domain = ctx.hubspotEvent?.companyDomain
    ? normalizeDomain(ctx.hubspotEvent.companyDomain)
    : undefined;

  if (!domain && emailDomain && !isFreeEmailDomain(emailDomain)) {
    domain = normalizeDomain(emailDomain) || undefined;
  }

  // Extract territory from email
  const territoryResult = extractTerritory({ email: ctx.attendeeEmail });

  const inferred = {
    domain,
    industry_key: 'other',
    confidence: 0.5,
    method: domain ? 'hubspot_domain' : 'fallback',
  };

  return {
    ...ctx,
    inferred,
    industryKey: inferred.industry_key || 'other',
    territory: territoryResult?.territory,
    territoryState: territoryResult?.state,
    territorySource: territoryResult?.source,
    territoryConfidence: territoryResult?.confidence,
  };
}

// ============================================================
// STEP 3: Fetch Question Templates (from static file)
// ============================================================

export function fetchQuestionTemplates(ctx: PipelineContext): PipelineContext {
  const industryQuestions = getQuestionsForIndustry(ctx.industryKey || 'other');
  const defaultQuestions = ctx.industryKey !== 'default' ? getQuestionsForIndustry('default') : [];
  const questionsRaw = Array.from(new Set([...defaultQuestions, ...industryQuestions]));

  return { ...ctx, questionsRaw };
}

// ============================================================
// STEP 4: Build Org Name
// ============================================================

export function buildOrgName(ctx: PipelineContext): PipelineContext {
  const emailDomain = (ctx.attendeeEmail || '').split('@')[1] || '';
  const domainForName = ctx.inferred?.domain || emailDomain;
  const humanOrg = humanizeOrgFromDomain(domainForName) || (emailDomain ? (emailDomain.split('.')[0] || '').replace(/[-_]/g, ' ') : '');

  // Prefer HubSpot company name if it looks like a real name (not a domain)
  const looksDomain = (s: string) => /\.[a-z]{2,}$/i.test(s) || /^[a-z0-9_-]+$/i.test(s);
  const hubspotName = (ctx.companyName || '').trim();
  const orgName = hubspotName && !looksDomain(hubspotName) ? hubspotName : humanOrg;

  return { ...ctx, orgName, displayName: ctx.attendeeName };
}

// ============================================================
// STEP 5: Generate Meeting Brief (placeholder)
// ============================================================

export async function generateMeetingBrief(ctx: PipelineContext): Promise<PipelineContext> {
  // Placeholder. In production: Serper search → Firecrawl scrape → LLM generate
  const briefHtml = `
    <h2>Meeting Brief: ${ctx.orgName || 'Unknown Company'}</h2>
    <p><strong>Attendee:</strong> ${ctx.attendeeName || ctx.attendeeEmail}</p>
    <p><strong>Domain:</strong> ${ctx.inferred?.domain || 'Not found'}</p>
    <p><strong>Industry:</strong> ${ctx.industryKey || 'Other'}</p>
    ${ctx.territory ? `<p><strong>Territory:</strong> ${ctx.territory}, ${ctx.territoryState}</p>` : ''}
    <hr>
    <p><em>Implement your research pipeline (Serper + Firecrawl + LLM) to generate detailed briefs.</em></p>
  `;

  return {
    ...ctx,
    briefResult: {
      brief_html: briefHtml,
      citations: [],
      metrics: {},
      sources: [],
    },
  };
}

// ============================================================
// STEP 6: Rewrite Questions
// ============================================================

export async function rewriteQuestions(ctx: PipelineContext): Promise<PipelineContext> {
  let rewrittenQuestions: string[] = [];

  try {
    rewrittenQuestions = await briefRewrite(ctx.questionsRaw || [], {});
  } catch {
    rewrittenQuestions = ctx.questionsRaw || [];
  }

  return { ...ctx, rewrittenQuestions };
}

// ============================================================
// STEP 7: Persist to HubSpot (create Note on contact)
// ============================================================

export async function persistToHubSpot(ctx: PipelineContext): Promise<PipelineContext> {
  if (!FLAGS.hubspotEnabled || !ctx.hubspotContactId) {
    ctx.log.info('HubSpot persistence skipped (disabled or no contact ID)');
    return ctx;
  }

  const meetingDate = ctx.eventDetails?.start_time
    ? new Date(ctx.eventDetails.start_time).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : 'TBD';

  const questionsHtml = (ctx.rewrittenQuestions || ctx.questionsRaw || [])
    .map((q) => `<li>${q}</li>`)
    .join('\n');

  const noteHtml = `
<h3>Meeting Brief: ${ctx.orgName || 'Unknown Company'}</h3>
<p><strong>Attendee:</strong> ${ctx.attendeeName || ''} (${ctx.attendeeEmail || ''})</p>
<p><strong>Meeting:</strong> ${ctx.eventDetails?.name || 'Meeting'} — ${meetingDate}</p>
<p><strong>Industry:</strong> ${ctx.industryKey || 'Other'}</p>
${ctx.territory ? `<p><strong>Location:</strong> ${ctx.territory}, ${ctx.territoryState}</p>` : ''}
<hr>
<h4>Research Summary</h4>
${ctx.briefResult?.brief_html || '<p>No brief generated.</p>'}
<hr>
<h4>Discovery Questions</h4>
<ol>
${questionsHtml}
</ol>
<span data-brief-meeting-id="${ctx.hubspotMeetingId}" style="display:none"></span>
`.trim();

  try {
    const noteId = await createNote(ctx.hubspotContactId, noteHtml);
    ctx.log.info(`HubSpot Note created: ${noteId} on contact ${ctx.hubspotContactId}`);
    return { ...ctx, hubspotNoteId: noteId };
  } catch (e) {
    ctx.log.error('Failed to create HubSpot Note', e);
    return ctx;
  }
}

// ============================================================
// STEP 8: Send Slack Notification (DM to rep)
// ============================================================

export async function sendSlackNotification(ctx: PipelineContext): Promise<PipelineContext> {
  if (!FLAGS.slackEnabled || !ENV.SLACK_CEO_USER_ID) {
    ctx.log.info('Slack notification skipped (disabled or no user ID configured)');
    return ctx;
  }

  try {
    await sendPrebrief({
      userId: ENV.SLACK_CEO_USER_ID,
      company: {
        name: ctx.orgName || 'Unknown',
        industry: ctx.industryKey,
        location: ctx.territory ? `${ctx.territory}, ${ctx.territoryState}` : undefined,
      },
      questions: ctx.rewrittenQuestions || [],
    });
    ctx.log.info('Slack DM sent');
  } catch (e) {
    ctx.log.error('Failed to send Slack DM', e);
  }

  return ctx;
}
