/**
 * Web research via parallel Serper queries.
 *
 * Five primary templates ported from the original meetingbrief pipeline,
 * plus up to three prior-company queries pulled from the LinkedIn timeline.
 * Results are deduplicated by URL.
 */

import { serperSearch, type SerperResult } from '../integrations/serper/client.js';
import type { PipelineLogger } from '../pipeline/types.js';
import type { SearchHit } from './types.js';

const RESULTS_PER_QUERY = 8;
const MAX_PRIOR_COMPANY_QUERIES = 3;

function quote(s: string): string {
  return `"${s.replace(/"/g, '\\"')}"`;
}

function buildPrimaryQueries(name: string, org: string): { q: string; tag: string }[] {
  const n = quote(name);
  const o = quote(org);
  return [
    { q: `${n} ${o}`, tag: 'primary' },
    { q: `${n} ${o} linkedin`, tag: 'linkedin' },
    { q: `${n} ${o} interview OR podcast OR conference`, tag: 'speaking' },
    { q: `${n} ${o} award OR recognition OR achievement`, tag: 'awards' },
    { q: `${n} joins OR appointed OR "new role"`, tag: 'jobchange' },
  ];
}

function buildPriorCompanyQueries(
  name: string,
  priorCompanies: string[],
): { q: string; tag: string }[] {
  return priorCompanies.slice(0, MAX_PRIOR_COMPANY_QUERIES).map((co) => ({
    q: `${quote(name)} ${quote(co)}`,
    tag: `prior:${co.slice(0, 30)}`,
  }));
}

async function runOne(
  q: string,
  tag: string,
  log: PipelineLogger,
): Promise<SearchHit[]> {
  try {
    const res: SerperResult = await serperSearch(q, { num: RESULTS_PER_QUERY });
    const hits: SearchHit[] = (res.organic ?? []).map((o) => {
      const hit: SearchHit = { title: o.title, link: o.link, query: tag };
      if (o.snippet) hit.snippet = o.snippet;
      return hit;
    });
    return hits;
  } catch (e) {
    log.warn(`Serper query failed [${tag}]: ${q}`, e);
    return [];
  }
}

export async function runSearches(
  name: string,
  org: string,
  priorCompanies: string[],
  log: PipelineLogger,
): Promise<SearchHit[]> {
  const queries = [
    ...buildPrimaryQueries(name, org),
    ...buildPriorCompanyQueries(name, priorCompanies),
  ];

  log.info(`Running ${queries.length} Serper queries in parallel`);
  const batches = await Promise.all(
    queries.map(({ q, tag }) => runOne(q, tag, log)),
  );

  // Deduplicate by URL, preferring earlier (higher-priority) queries
  const byUrl = new Map<string, SearchHit>();
  for (const batch of batches) {
    for (const hit of batch) {
      if (!hit.link) continue;
      if (!byUrl.has(hit.link)) byUrl.set(hit.link, hit);
    }
  }

  const out = Array.from(byUrl.values());
  log.info(`Search produced ${out.length} unique hits across ${queries.length} queries`);
  return out;
}
