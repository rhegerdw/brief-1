/**
 * Main entry point: build a meeting brief for (name, org).
 *
 * Orchestrates resolveLinkedIn → runSearches → triageResults → scrapeWaves
 * → generateBrief, returning a fully rendered HTML brief plus citations,
 * sources, and metrics.
 */

import type { PipelineLogger } from '../pipeline/types.js';
import { resolveLinkedIn } from './linkedin.js';
import { runSearches } from './search.js';
import { triageResults } from './triage.js';
import { scrapeWaves } from './scrape.js';
import { generateBrief } from './generate.js';
import type { BriefInput, BriefOutput } from './types.js';

export interface BuildMeetingBriefOptions {
  linkedinUrl?: string;
  domain?: string;
  email?: string;
  log: PipelineLogger;
}

export async function buildMeetingBrief(
  name: string,
  org: string,
  opts: BuildMeetingBriefOptions,
): Promise<BriefOutput> {
  const { log } = opts;
  const startedAt = Date.now();

  const input: BriefInput = { name, org };
  if (opts.linkedinUrl) input.linkedinUrl = opts.linkedinUrl;
  if (opts.domain) input.domain = opts.domain;
  if (opts.email) input.email = opts.email;

  log.info(`buildMeetingBrief start: ${name} @ ${org} (linkedin: ${input.linkedinUrl ? 'provided' : 'lookup'})`);

  // 1. Resolve LinkedIn
  const linkedin = await resolveLinkedIn(input, log);
  log.info(
    `LinkedIn resolution: source=${linkedin.source}, match=${linkedin.companyMatch}, prior=${linkedin.priorCompanies.length}`,
  );

  // Only feed prior companies into the disambiguation list if the profile
  // looks legitimate (matched or unknown — never on a confirmed mismatch).
  const knownCompanies =
    linkedin.companyMatch === 'mismatch'
      ? [org]
      : [org, ...(linkedin.currentCompany ? [linkedin.currentCompany] : []), ...linkedin.priorCompanies];

  // 2. Web searches (skip if we can't get anything useful out of them)
  const hits = await runSearches(name, org, linkedin.priorCompanies, log);

  // 3. Triage
  const scored = await triageResults(hits, name, org, knownCompanies, log);

  // 4. Scrape (waves)
  const sources = await scrapeWaves(scored, log);

  // 5. Generate
  const linkedinUrlForBrief =
    linkedin.linkedinUrl ?? input.linkedinUrl ?? undefined;
  const briefArgs: Parameters<typeof generateBrief>[0] = {
    sources,
    name,
    org,
    jobTimeline: linkedin.jobTimeline,
    eduTimeline: linkedin.eduTimeline,
    startedAt,
    searchHits: hits.length,
    scoredHits: scored.length,
    hasLinkedIn: linkedin.resolved,
    linkedinFromInput: Boolean(input.linkedinUrl),
    log,
  };
  if (linkedinUrlForBrief) briefArgs.linkedinUrl = linkedinUrlForBrief;
  const out = await generateBrief(briefArgs);

  log.info(
    `buildMeetingBrief done in ${out.metrics.durationMs}ms (${out.metrics.scrapedSources} sources, ${out.metrics.promptTokens + out.metrics.completionTokens} tokens)`,
  );
  return out;
}
