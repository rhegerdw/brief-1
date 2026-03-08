/**
 * Composable steps for the prebrief pipeline
 * Each step is a pure function that takes context and returns updated context
 */

import { ENV, FLAGS } from '../config/env.js';
import { extractTerritory } from '../utils/territory.js';
import { supabaseAdmin } from '../integrations/supabase/client.js';
import { extractCompanyName, extractWebsite, type CalendlyQA } from '../integrations/calendly/parser.js';
import { briefRewrite } from '../ai/briefRewrite.js';
import { getPublicBaseUrl } from '../utils/baseUrl.js';
import { humanizeOrgFromDomain, normalizeDomain, isFreeEmailDomain, isLikelyCompanyWebsite } from '../utils/domain.js';
import { sendOps } from '../integrations/slack/client.js';
import { sendPrebrief } from '../integrations/slack/sendPrebrief.js';
import type { PipelineContext, MeetingPayload } from './types.js';

// ============================================================
// STEP 1: Fetch Event Details (Calendly-specific)
// ============================================================

export async function fetchEventDetails(ctx: PipelineContext): Promise<PipelineContext> {
  // For Google Calendar events, details are already in googleEvent
  if (ctx.source === 'google' && ctx.googleEvent) {
    return {
      ...ctx,
      eventDetails: {
        uuid: ctx.googleEvent.eventId,
        start_time: ctx.googleEvent.start,
        end_time: ctx.googleEvent.end,
        name: ctx.googleEvent.summary,
        status: 'active',
        join_url: ctx.googleEvent.conferenceLink || ctx.googleEvent.hangoutLink,
      },
      eventUuid: ctx.googleEvent.eventId,
      attendeeEmail: ctx.googleEvent.attendee.email,
      attendeeName: ctx.googleEvent.attendee.name,
    };
  }

  // For Calendly, fetch from API if possible
  let eventDetails = ctx.calendlyPayload?.payload?.event || {};
  const eventUuid = ctx.calendlyPayload?.payload?.event?.uuid;

  if (eventUuid && ENV.CALENDLY_API_KEY) {
    try {
      const { eventByUri } = await import('../integrations/calendly/client.js');
      const eventUri = `https://api.calendly.com/scheduled_events/${eventUuid}`;
      const fetchedEvent = await eventByUri(eventUri);
      if (fetchedEvent?.resource) {
        eventDetails = {
          uuid: fetchedEvent.resource.uuid || eventUuid,
          start_time: fetchedEvent.resource.start_time,
          end_time: fetchedEvent.resource.end_time,
          name: fetchedEvent.resource.name,
          status: fetchedEvent.resource.status,
          join_url: fetchedEvent.resource.location?.join_url || ctx.calendlyPayload?.payload?.event?.join_url
        };
        ctx.log.info(`Fetched authoritative event details for ${eventUuid}`);
      }
    } catch {
      ctx.log.warn('Failed to fetch event details from Calendly API, using webhook payload');
    }
  }

  return {
    ...ctx,
    eventDetails,
    eventUuid,
    attendeeEmail: ctx.calendlyPayload?.payload?.invitee?.email,
    attendeeName: ctx.calendlyPayload?.payload?.invitee?.name,
  };
}

// ============================================================
// STEP 2: Parse Form Inputs
// ============================================================

export function parseFormInputs(ctx: PipelineContext): PipelineContext {
  // For Google Calendar, we don't have form data
  if (ctx.source === 'google') {
    const territoryResult = extractTerritory({
      email: ctx.attendeeEmail,
    });
    return {
      ...ctx,
      territory: territoryResult?.territory,
      territoryState: territoryResult?.state,
      territorySource: territoryResult?.source,
      territoryConfidence: territoryResult?.confidence,
    };
  }

  // For Calendly, parse Q&A
  const qas = ctx.calendlyPayload?.payload?.questions_and_answers || [];
  const websiteFromFormRaw = extractWebsite(qas);
  const websiteFromForm = websiteFromFormRaw || undefined;
  const companyNameFromForm = extractCompanyName(qas) || undefined;
  const normalizedFormDomain = normalizeDomain(websiteFromFormRaw || null);
  const websiteLooksValid = !!(normalizedFormDomain && isLikelyCompanyWebsite(normalizedFormDomain) && !isFreeEmailDomain(normalizedFormDomain));

  const territoryResult = extractTerritory({
    companyName: companyNameFromForm,
    email: ctx.attendeeEmail,
  });

  return {
    ...ctx,
    qas,
    websiteFromForm,
    companyNameFromForm,
    normalizedFormDomain,
    websiteLooksValid,
    territory: territoryResult?.territory,
    territoryState: territoryResult?.state,
    territorySource: territoryResult?.source,
    territoryConfidence: territoryResult?.confidence,
  };
}

// ============================================================
// STEP 3: Infer Domain and Industry
// ============================================================

export async function inferDomainIndustry(ctx: PipelineContext): Promise<PipelineContext> {
  // Simple inference: use email domain if website not provided
  const emailDomain = ctx.attendeeEmail?.split('@')[1] || '';
  let domain = ctx.websiteLooksValid ? ctx.normalizedFormDomain! : undefined;

  if (!domain && emailDomain && !isFreeEmailDomain(emailDomain)) {
    domain = normalizeDomain(emailDomain) || undefined;
  }

  const inferred = {
    domain,
    industry_key: 'other',
    confidence: 0.5,
    method: domain ? 'email_domain' : 'fallback',
  };

  return { ...ctx, inferred, industryKey: inferred.industry_key || 'other' };
}

// ============================================================
// STEP 4: Upsert Company and Meeting
// ============================================================

export async function upsertCompanyMeeting(ctx: PipelineContext): Promise<PipelineContext> {
  const meetingPayload: MeetingPayload = {
    external_event_id: ctx.eventDetails?.uuid || ctx.eventUuid,
    attendee_email: ctx.attendeeEmail,
    attendee_name: ctx.attendeeName,
    start_time: ctx.eventDetails?.start_time,
    join_url: ctx.eventDetails?.join_url,
    questions_and_answers: ctx.qas,
    industry_key: ctx.industryKey,
    company_name: ctx.companyNameFromForm || undefined,
    website: ctx.websiteFromForm || undefined,
    domain: (ctx.websiteLooksValid ? ctx.normalizedFormDomain : undefined) || ctx.inferred?.domain || undefined,
    territory: ctx.territory,
    state: ctx.territoryState,
    source: ctx.source,
  };

  // Try RPC first
  const up = await supabaseAdmin.rpc('upsert_company_contact', { meeting_payload: meetingPayload as unknown as Record<string, unknown> });
  let ids: { company_id?: string; meeting_id?: string } = (up.data as { company_id?: string; meeting_id?: string }) || {};

  if (up.error) {
    ctx.log.warn('upsert_company_contact RPC failed; falling back to direct upserts', up.error);
  }

  // Fallback: direct upserts
  if (!ids?.company_id || !ids?.meeting_id) {
    ids = await directUpsertFallback(meetingPayload, ids, ctx.log);
  }

  return { ...ctx, companyId: ids.company_id, meetingId: ids.meeting_id, meetingPayload };
}

async function directUpsertFallback(
  meetingPayload: MeetingPayload,
  existingIds: { company_id?: string; meeting_id?: string },
  log: PipelineContext['log']
): Promise<{ company_id: string; meeting_id: string }> {
  let companyId: string | undefined = existingIds?.company_id;
  const domain = (meetingPayload.domain || '').toLowerCase() || null;
  const compName = (meetingPayload.company_name || '').toString().trim() || null;
  const territory = (meetingPayload.territory || '').toString().trim() || null;
  const state = (meetingPayload.state || '').toString().trim() || null;

  if (!companyId) {
    let existing: { id: string } | null = null;

    // Domain match
    if (domain) {
      const { data: ex1 } = await supabaseAdmin.from('companies').select('id').eq('domain', domain).limit(1);
      existing = ex1 && ex1[0] ? ex1[0] : null;
    }

    // Name match
    if (!existing && compName) {
      const { data: ex2 } = await supabaseAdmin.from('companies').select('id').ilike('name', compName).limit(1);
      existing = ex2 && ex2[0] ? ex2[0] : null;
    }

    if (existing) {
      companyId = existing.id;
    }

    // Create new company
    if (!companyId) {
      const candidateName = compName || domain || 'Unknown';
      const ins = await supabaseAdmin.from('companies').insert({
        name: candidateName,
        domain: domain || null,
        territory,
        state,
      }).select('id').single();
      if (ins.data?.id) companyId = ins.data.id;
    }
  }
  if (!companyId) throw new Error('Failed to resolve company_id');

  let meetingId: string | undefined = existingIds?.meeting_id;
  const ext = (meetingPayload.external_event_id || '').toString().trim() || null;

  if (!meetingId && ext) {
    const { data: mx } = await supabaseAdmin.from('meetings').select('id').eq('external_event_id', ext).limit(1);
    if (mx && mx[0]) meetingId = mx[0].id;
  }

  if (!meetingId) {
    const insm = await supabaseAdmin.from('meetings').insert({
      company_id: companyId,
      attendee: meetingPayload.attendee_name || null,
      attendee_email: meetingPayload.attendee_email || null,
      starts_at: meetingPayload.start_time || null,
      join_url: meetingPayload.join_url || null,
      external_event_id: meetingPayload.external_event_id || null,
      source: meetingPayload.source || 'calendly',
    }).select('id').single();
    if (insm.data?.id) meetingId = insm.data.id;
  }
  if (!meetingId) throw new Error('Failed to resolve meeting_id');

  log.info(`Direct upserts created ids: company=${companyId}, meeting=${meetingId}`);
  return { company_id: companyId, meeting_id: meetingId };
}

// ============================================================
// STEP 5: Fetch Question Templates
// ============================================================

export async function fetchQuestionTemplates(ctx: PipelineContext): Promise<PipelineContext> {
  const [indRes, genRes] = await Promise.all([
    supabaseAdmin.from('question_templates').select('questions').eq('industry_key', ctx.industryKey).single(),
    supabaseAdmin.from('question_templates').select('questions').eq('industry_key', 'generic').single(),
  ]);

  let indQs: string[] = Array.isArray(indRes.data?.questions) ? (indRes.data.questions as string[]) : [];
  const genQs: string[] = Array.isArray(genRes.data?.questions) ? (genRes.data.questions as string[]) : [
    'What is the core value proposition and target customer?',
    'What are the top 3 risks this year?',
    'How do you acquire customers and what is the win rate?',
    'What is revenue and margin trend over the last 3 years?',
  ];

  const questionsRaw: string[] = Array.from(new Set([...genQs, ...indQs]));

  return { ...ctx, questionsRaw };
}

// ============================================================
// STEP 6: Build Org Name
// ============================================================

export async function buildOrgName(ctx: PipelineContext): Promise<PipelineContext> {
  const companyRow = await supabaseAdmin.from('companies').select('name, location').eq('id', ctx.companyId).single();

  const emailDomain = (ctx.meetingPayload?.attendee_email || '').split('@')[1] || '';
  const looksDomainFn = (s: string) => /\.[a-z]{2,}$/i.test(s) || /^[a-z0-9_-]+$/i.test(s);
  const existingName = (companyRow.data?.name || '').trim();
  const domainForName = ctx.inferred?.domain || normalizeDomain(ctx.websiteFromForm || null) || emailDomain || '';
  const humanOrg = humanizeOrgFromDomain(domainForName) || (emailDomain ? (emailDomain.split('.')[0] || '').replace(/[-_]/g, ' ') : '');
  const orgName = existingName && !looksDomainFn(existingName) ? existingName : humanOrg;

  return { ...ctx, companyRow: companyRow.data || {}, orgName };
}

// ============================================================
// STEP 7: Generate Meeting Brief (placeholder - implement with your research pipeline)
// ============================================================

export async function generateMeetingBrief(ctx: PipelineContext): Promise<PipelineContext> {
  // This is a placeholder. In production, you would:
  // 1. Run Serper search for the company
  // 2. Scrape relevant URLs with Firecrawl
  // 3. Generate brief with OpenAI

  const briefHtml = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <h2>Meeting Brief: ${ctx.orgName || 'Unknown Company'}</h2>
      <p><strong>Attendee:</strong> ${ctx.attendeeName || ctx.attendeeEmail}</p>
      <p><strong>Domain:</strong> ${ctx.inferred?.domain || 'Not found'}</p>
      <p><strong>Industry:</strong> ${ctx.industryKey || 'Other'}</p>
      ${ctx.territory ? `<p><strong>Territory:</strong> ${ctx.territory}, ${ctx.territoryState}</p>` : ''}
      <hr>
      <p><em>Implement your research pipeline (Serper + Firecrawl + OpenAI) to generate detailed briefs.</em></p>
    </div>
  `;

  return {
    ...ctx,
    displayName: ctx.attendeeName,
    briefResult: {
      brief_html: briefHtml,
      citations: [],
      metrics: {},
      sources: [],
    },
  };
}

// ============================================================
// STEP 8: Rewrite Questions
// ============================================================

export async function rewriteQuestions(ctx: PipelineContext): Promise<PipelineContext> {
  let rewrittenQuestions: string[] = [];

  try {
    rewrittenQuestions = await briefRewrite(ctx.questionsRaw || [], { meeting_id: ctx.meetingId, company_id: ctx.companyId });
  } catch {
    rewrittenQuestions = ctx.questionsRaw || [];
  }

  return { ...ctx, rewrittenQuestions };
}

// ============================================================
// STEP 9: Persist Brief
// ============================================================

export async function persistBrief(ctx: PipelineContext): Promise<PipelineContext> {
  try {
    await supabaseAdmin
      .from('meetingbrief_results')
      .upsert({
        meeting_id: ctx.meetingId,
        attendee_name: ctx.displayName,
        attendee_email: ctx.meetingPayload?.attendee_email,
        company_name: ctx.orgName || ctx.companyRow?.name || null,
        brief_html: ctx.briefResult?.brief_html || '',
        citations: ctx.briefResult?.citations as unknown as Record<string, unknown>[],
        metrics: {
          ...(ctx.briefResult?.metrics || {}),
          questions: ctx.rewrittenQuestions
        } as unknown as Record<string, unknown>,
        sources: ctx.briefResult?.sources as unknown as Record<string, unknown>[],
      }, { onConflict: 'meeting_id' });
  } catch (e) {
    ctx.log.warn('Failed to persist meetingbrief_results', e);
  }

  return ctx;
}

// ============================================================
// STEP 10: Create Brief URL
// ============================================================

export async function createBriefUrl(ctx: PipelineContext): Promise<PipelineContext> {
  const linkUrl = `${getPublicBaseUrl()}/api/view/brief?meeting_id=${encodeURIComponent(ctx.meetingId!)}`;
  return { ...ctx, linkUrl };
}

// ============================================================
// STEP 11: Send Slack Notifications
// ============================================================

export async function sendSlackNotifications(ctx: PipelineContext): Promise<PipelineContext> {
  if (FLAGS.slackEnabled && ENV.SLACK_BRIEF_CHANNEL_ID) {
    try {
      const now = new Date().toISOString();
      const { data: lockResult, error: lockError } = await supabaseAdmin
        .from('meetingbrief_results')
        .update({ slack_notified_at: now })
        .eq('meeting_id', ctx.meetingId)
        .is('slack_notified_at', null)
        .select('meeting_id');

      if (lockError) {
        ctx.log.error('[Slack] Lock error', lockError, { meeting_id: ctx.meetingId });
      } else if (!lockResult || lockResult.length === 0) {
        ctx.log.info(`[Slack] Skipping notification for meeting ${ctx.meetingId} (already locked)`);
      } else {
        const slackRes = await fetch('https://slack.com/api/chat.postMessage', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${ENV.SLACK_BOT_TOKEN}`,
            'Content-Type': 'application/json; charset=utf-8',
          },
          body: JSON.stringify({
            channel: ENV.SLACK_BRIEF_CHANNEL_ID,
            text: `New meeting brief: ${ctx.displayName} (${ctx.orgName || ctx.companyRow?.name})`,
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `*New Meeting Brief Ready*\n\n<${ctx.linkUrl}|${ctx.displayName} — ${ctx.orgName || ctx.companyRow?.name || 'Unknown Company'}>`
                }
              }
            ]
          }),
        });
        const slackData = await slackRes.json();
        if (!slackData.ok) {
          ctx.log.error('[Slack] Failed to send notification', slackData, { meeting_id: ctx.meetingId });
          await supabaseAdmin
            .from('meetingbrief_results')
            .update({ slack_notified_at: null })
            .eq('meeting_id', ctx.meetingId);
        } else {
          ctx.log.info(`[Slack] Notification sent for meeting ${ctx.meetingId}`);
        }
      }
    } catch (e) {
      ctx.log.error('[Slack] Error sending notification', e, { meeting_id: ctx.meetingId });
    }
  }

  // CEO DM
  if (FLAGS.slackEnabled && ENV.SLACK_CEO_USER_ID) {
    await sendPrebrief({
      userId: ENV.SLACK_CEO_USER_ID as string,
      company: { name: ctx.companyRow?.name || 'Unknown', industry: ctx.industryKey, location: ctx.companyRow?.location },
      questions: ctx.rewrittenQuestions || [],
      briefUrl: ctx.linkUrl,
    });
  } else {
    ctx.log.info(`Pre-brief ready: meeting_id=${ctx.meetingId}, linkUrl=${ctx.linkUrl}`);
  }

  return ctx;
}
