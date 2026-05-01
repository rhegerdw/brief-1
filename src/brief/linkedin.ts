/**
 * LinkedIn resolution + profile extraction.
 *
 * Optimisation: when HubSpot supplies `hs_linkedin_url` we go straight to
 * `fetchProfile()` and skip the Harvest search step entirely.
 *
 * Includes an LLM-based company verification check, ported from the original
 * meetingbrief pipeline, that handles abbreviations, subsidiaries, and
 * parent-company name mismatches.
 */

import {
  enrichPerson,
  fetchProfile,
  type HarvestProfile,
  type HarvestPosition,
} from '../integrations/harvest/client.js';
import { llmJSON } from '../ai/llm.js';
import type { PipelineLogger } from '../pipeline/types.js';
import type {
  BriefInput,
  JobTimelineEntry,
  EduTimelineEntry,
} from './types.js';

export interface LinkedInResult {
  /** Whether we found and verified a profile to use for the brief. */
  resolved: boolean;
  /** Source of the profile resolution (helps with debugging and metrics). */
  source: 'hubspot' | 'harvest_search' | 'none';
  profile?: HarvestProfile;
  linkedinUrl?: string;
  jobTimeline: JobTimelineEntry[];
  eduTimeline: EduTimelineEntry[];
  /** Distinct prior employer names, most recent first. */
  priorCompanies: string[];
  /** Detected current company name from the profile (post-verification). */
  currentCompany?: string;
  /** Whether profile current company matched (or plausibly matched) the target org. */
  companyMatch: 'match' | 'mismatch' | 'unknown';
  companyMatchReason?: string;
}

const EMPTY: LinkedInResult = {
  resolved: false,
  source: 'none',
  jobTimeline: [],
  eduTimeline: [],
  priorCompanies: [],
  companyMatch: 'unknown',
};

function yearOf(d?: { year?: number }): number | undefined {
  return d?.year && d.year > 1900 ? d.year : undefined;
}

function buildJobTimeline(profile: HarvestProfile): JobTimelineEntry[] {
  const positions: HarvestPosition[] = [
    ...(profile.currentPosition ?? []),
    ...(profile.experience ?? []),
  ];
  const seen = new Set<string>();
  const out: JobTimelineEntry[] = [];
  for (const p of positions) {
    if (!p.companyName) continue;
    const key = `${p.companyName}|${p.title || ''}|${p.startedOn?.year || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const startYear = yearOf(p.startedOn);
    const endYearRaw = yearOf(p.endedOn);
    const endYear = endYearRaw ?? (p === (profile.currentPosition?.[0]) ? 'present' as const : undefined);
    const entry: JobTimelineEntry = {
      company: p.companyName,
    };
    if (p.title) entry.title = p.title;
    if (startYear !== undefined) entry.startYear = startYear;
    if (endYear !== undefined) entry.endYear = endYear;
    if (p.location) entry.location = p.location;
    out.push(entry);
  }
  return out;
}

function buildEduTimeline(profile: HarvestProfile): EduTimelineEntry[] {
  return (profile.education ?? [])
    .filter((e) => e.title)
    .map((e) => {
      const entry: EduTimelineEntry = { school: e.title || '' };
      if (e.degree) entry.degree = e.degree;
      const sy = yearOf(e.startedOn);
      const ey = yearOf(e.endedOn);
      if (sy !== undefined) entry.startYear = sy;
      if (ey !== undefined) entry.endYear = ey;
      return entry;
    });
}

function distinctPriorCompanies(timeline: JobTimelineEntry[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const j of timeline) {
    const norm = j.company.trim();
    if (!norm) continue;
    const key = norm.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(norm);
  }
  return out;
}

/**
 * LLM company-match verification. Decides whether the resolved LinkedIn
 * profile actually works at the target company (handles abbreviations,
 * subsidiaries, "parent co", "DBA" patterns).
 */
async function verifyCompanyMatch(
  profile: HarvestProfile,
  targetOrg: string,
  log: PipelineLogger,
): Promise<{ match: 'match' | 'mismatch' | 'unknown'; reason?: string; currentCompany?: string }> {
  const currentCompany =
    profile.currentPosition?.[0]?.companyName || profile.experience?.[0]?.companyName;

  if (!currentCompany) {
    return { match: 'unknown', reason: 'No current company on profile' };
  }
  if (!targetOrg) {
    return { match: 'unknown', reason: 'No target org provided', currentCompany };
  }

  // Quick cheap check: substring match on either side
  const a = currentCompany.toLowerCase().replace(/[,.\s]+/g, ' ').trim();
  const b = targetOrg.toLowerCase().replace(/[,.\s]+/g, ' ').trim();
  if (a === b || a.includes(b) || b.includes(a)) {
    return { match: 'match', reason: 'Direct name match', currentCompany };
  }

  const headline = profile.headline ?? '';
  const recent = (profile.experience ?? []).slice(0, 3)
    .map((p) => `- ${p.title ?? ''} @ ${p.companyName ?? ''}`)
    .join('\n');

  const system = `You are verifying whether a LinkedIn profile belongs to someone who currently works at a specific target company. Account for abbreviations (e.g. "IBM" vs "International Business Machines"), subsidiaries / parent companies, DBAs, recent acquisitions, and franchise/holding structures. Respond with strict JSON.`;

  const user = `Target company: "${targetOrg}"

Profile current company: "${currentCompany}"
Headline: "${headline}"
Recent positions:
${recent || '(none)'}

Decide whether this person currently works at the target company.

Respond as JSON:
{
  "match": "match" | "mismatch" | "unknown",
  "reason": "<brief explanation>"
}`;

  try {
    const result = await llmJSON<{ match: string; reason?: string }>({
      system,
      user,
      tier: 'fast',
      temperature: 0,
      ctx: { pipeline: 'brief', step: 'linkedin_company_verify' },
    });
    const m = (result.data.match || 'unknown').toLowerCase();
    const decision: 'match' | 'mismatch' | 'unknown' =
      m === 'match' || m === 'mismatch' ? m : 'unknown';
    const out: { match: 'match' | 'mismatch' | 'unknown'; reason?: string; currentCompany: string } = {
      match: decision,
      currentCompany,
    };
    if (result.data.reason) out.reason = result.data.reason;
    return out;
  } catch (e) {
    log.warn('LinkedIn company verification failed', e);
    return { match: 'unknown', reason: 'verification failed', currentCompany };
  }
}

export async function resolveLinkedIn(
  input: BriefInput,
  log: PipelineLogger,
): Promise<LinkedInResult> {
  // --- Path A: HubSpot supplied a LinkedIn URL ---
  if (input.linkedinUrl) {
    log.info(`LinkedIn URL from HubSpot: ${input.linkedinUrl}`);
    let profile: HarvestProfile | null = null;
    try {
      profile = await fetchProfile(input.linkedinUrl);
    } catch (e) {
      log.warn('fetchProfile failed for HubSpot URL', e);
    }

    if (profile) {
      const jobTimeline = buildJobTimeline(profile);
      const eduTimeline = buildEduTimeline(profile);
      const priorCompanies = distinctPriorCompanies(jobTimeline.slice(1)); // exclude current
      const verification = await verifyCompanyMatch(profile, input.org, log);
      const result: LinkedInResult = {
        resolved: true,
        source: 'hubspot',
        profile,
        linkedinUrl: profile.linkedinUrl || input.linkedinUrl,
        jobTimeline,
        eduTimeline,
        priorCompanies,
        companyMatch: verification.match,
      };
      if (verification.currentCompany) result.currentCompany = verification.currentCompany;
      if (verification.reason) result.companyMatchReason = verification.reason;
      return result;
    }

    log.warn('HubSpot LinkedIn URL did not resolve to a profile, falling back to search');
  }

  // --- Path B: Harvest search by name + org ---
  const [firstName, ...rest] = input.name.trim().split(/\s+/);
  const lastName = rest.join(' ');
  if (!firstName || !lastName) {
    log.warn(`Cannot Harvest-search without first+last name (got "${input.name}")`);
    return EMPTY;
  }

  let profile: HarvestProfile | null = null;
  try {
    profile = await enrichPerson(firstName, lastName, input.org);
  } catch (e) {
    log.warn('Harvest enrichPerson failed', e);
  }

  if (!profile) return EMPTY;

  const jobTimeline = buildJobTimeline(profile);
  const eduTimeline = buildEduTimeline(profile);
  const priorCompanies = distinctPriorCompanies(jobTimeline.slice(1));
  const verification = await verifyCompanyMatch(profile, input.org, log);

  const result: LinkedInResult = {
    resolved: true,
    source: 'harvest_search',
    profile,
    jobTimeline,
    eduTimeline,
    priorCompanies,
    companyMatch: verification.match,
  };
  if (profile.linkedinUrl) result.linkedinUrl = profile.linkedinUrl;
  if (verification.currentCompany) result.currentCompany = verification.currentCompany;
  if (verification.reason) result.companyMatchReason = verification.reason;
  return result;
}
