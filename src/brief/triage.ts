/**
 * LLM-based snippet triage.
 *
 * Filters blocked/low-trust domains, then asks an LLM to score each remaining
 * snippet 1–10 for relevance to (name @ org). For low-stakes results we mark
 * `canSkipScrape` so the brief generator can use the snippet's extracted facts
 * directly instead of paying for a Firecrawl scrape.
 */

import { getDomain } from 'tldts';
import { llmJSON } from '../ai/llm.js';
import type { PipelineLogger } from '../pipeline/types.js';
import { BLOCKED_DOMAINS, LOW_TRUST_DOMAINS } from './constants.js';
import type { ScoredSnippet, SearchHit } from './types.js';

interface TriageVerdict {
  index: number;
  priority: number;
  canSkipScrape: boolean;
  extractedFacts?: string;
  reason?: string;
}

interface TriageBatchResponse {
  verdicts: TriageVerdict[];
}

const BATCH_SIZE = 12;

function domainOf(url: string): string {
  try {
    return (getDomain(url) || new URL(url).hostname).toLowerCase();
  } catch {
    return '';
  }
}

function preFilter(hits: SearchHit[], log: PipelineLogger): SearchHit[] {
  const kept: SearchHit[] = [];
  let blocked = 0;
  for (const h of hits) {
    const d = domainOf(h.link);
    if (!d) continue;
    if (BLOCKED_DOMAINS.has(d)) {
      blocked++;
      continue;
    }
    kept.push(h);
  }
  log.info(`Triage pre-filter: dropped ${blocked} blocked-domain hits, kept ${kept.length}`);
  return kept;
}

async function scoreBatch(
  batch: SearchHit[],
  name: string,
  org: string,
  knownCompanies: string[],
  log: PipelineLogger,
): Promise<TriageVerdict[]> {
  const system = `You are triaging Google search results for a meeting-prep research brief on a specific person at a specific company. For each snippet decide:
- priority (1–10): how useful this source likely is for the brief. 10 = directly about the target person at the target company, 1 = irrelevant or wrong person.
- canSkipScrape: true if the snippet itself already contains everything useful and a full page-scrape would not add meaningful information (e.g. a one-line news headline, or a directory entry). false if scraping would meaningfully help.
- extractedFacts: 1–2 short sentences summarizing what this snippet tells you about the person. Empty string if nothing useful.

CRITICAL — name disambiguation: many people share a name. Use the "Known companies" list below to confirm you're looking at the right person. If a snippet clearly refers to someone unrelated (different industry, no overlapping employer), score it 1–2.`;

  const knownLine = knownCompanies.length
    ? knownCompanies.slice(0, 8).join(', ')
    : '(none known)';

  const user = `Target person: ${name}
Target company: ${org}
Known companies (current + prior employers from LinkedIn): ${knownLine}

Snippets:
${batch
  .map(
    (h, i) => `[${i}] (${h.query}) ${h.title}
URL: ${h.link}
Snippet: ${h.snippet ?? ''}`,
  )
  .join('\n\n')}

Respond as strict JSON:
{
  "verdicts": [
    { "index": 0, "priority": <1-10>, "canSkipScrape": <bool>, "extractedFacts": "<short>", "reason": "<short>" },
    ...
  ]
}
Include exactly one verdict per snippet, indexed 0..${batch.length - 1}.`;

  try {
    const res = await llmJSON<TriageBatchResponse>({
      system,
      user,
      tier: 'fast',
      temperature: 0,
      ctx: { pipeline: 'brief', step: 'triage' },
    });
    return res.data.verdicts ?? [];
  } catch (e) {
    log.warn('Triage LLM batch failed; defaulting to neutral scores', e);
    return batch.map((_, i) => ({ index: i, priority: 5, canSkipScrape: false }));
  }
}

export async function triageResults(
  hits: SearchHit[],
  name: string,
  org: string,
  knownCompanies: string[],
  log: PipelineLogger,
): Promise<ScoredSnippet[]> {
  const filtered = preFilter(hits, log);
  if (filtered.length === 0) return [];

  const scored: ScoredSnippet[] = [];
  for (let i = 0; i < filtered.length; i += BATCH_SIZE) {
    const batch = filtered.slice(i, i + BATCH_SIZE);
    const verdicts = await scoreBatch(batch, name, org, knownCompanies, log);
    const byIdx = new Map(verdicts.map((v) => [v.index, v]));
    batch.forEach((hit, idx) => {
      const v = byIdx.get(idx);
      const dom = domainOf(hit.link);
      const lowTrust = LOW_TRUST_DOMAINS.has(dom);
      const rawPriority = v ? Math.max(1, Math.min(10, Math.round(v.priority))) : 4;
      // Penalise low-trust domains so they only survive when nothing better exists
      const priority = lowTrust ? Math.min(rawPriority, 3) : rawPriority;
      const snippet: ScoredSnippet = {
        ...hit,
        priority,
        canSkipScrape: lowTrust ? true : Boolean(v?.canSkipScrape),
        domain: dom,
      };
      if (v?.extractedFacts) snippet.extractedFacts = v.extractedFacts;
      if (v?.reason) snippet.reason = v.reason;
      scored.push(snippet);
    });
  }

  // Sort highest-priority first
  scored.sort((a, b) => b.priority - a.priority);
  log.info(`Triage scored ${scored.length} snippets (top priority: ${scored[0]?.priority ?? 'n/a'})`);
  return scored;
}
