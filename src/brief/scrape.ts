/**
 * Wave-based scraping.
 *
 * Wave 1 (priority ≥ WAVE1_MIN_PRIORITY): critical sources.
 * Wave 2 (priority ≥ WAVE2_MIN_PRIORITY): medium sources.
 *
 * Snippets marked `canSkipScrape` are kept as virtual sources whose "content"
 * is the LLM-extracted facts from the triage step — no Firecrawl call needed.
 *
 * Concurrency capped by FIRECRAWL_MAX_CONCURRENCY (default 2).
 */

import { firecrawlScrape } from '../integrations/firecrawl/client.js';
import { ENV } from '../config/env.js';
import type { PipelineLogger } from '../pipeline/types.js';
import {
  MAX_CONTENT_PER_SOURCE,
  MAX_SCRAPE_TARGETS,
  WAVE1_MIN_PRIORITY,
  WAVE2_MIN_PRIORITY,
} from './constants.js';
import type { ScoredSnippet, ScrapedSource } from './types.js';

function defaultConcurrency(): number {
  const raw = ENV.FIRECRAWL_MAX_CONCURRENCY;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 2;
}

function clampContent(text: string): string {
  if (text.length <= MAX_CONTENT_PER_SOURCE) return text;
  return text.slice(0, MAX_CONTENT_PER_SOURCE) + ' …[truncated]';
}

function snippetToVirtualSource(s: ScoredSnippet): ScrapedSource {
  const facts = s.extractedFacts || s.snippet || s.title;
  return {
    url: s.link,
    title: s.title,
    content: clampContent(facts),
    priority: s.priority,
    domain: s.domain,
    fromSnippet: true,
  };
}

async function scrapePool(
  targets: ScoredSnippet[],
  concurrency: number,
  log: PipelineLogger,
): Promise<ScrapedSource[]> {
  const out: ScrapedSource[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const idx = cursor++;
      if (idx >= targets.length) return;
      const s = targets[idx];
      const result = await firecrawlScrape(s.link);
      if (result && result.content) {
        out.push({
          url: s.link,
          title: result.title || s.title,
          content: clampContent(result.content),
          priority: s.priority,
          domain: s.domain,
        });
      } else {
        log.info(`Firecrawl returned no content for ${s.link}; falling back to snippet`);
        out.push(snippetToVirtualSource(s));
      }
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, targets.length));
  await Promise.all(Array.from({ length: workerCount }, worker));
  return out;
}

export async function scrapeWaves(
  scored: ScoredSnippet[],
  log: PipelineLogger,
): Promise<ScrapedSource[]> {
  if (scored.length === 0) return [];

  const concurrency = defaultConcurrency();
  const seen = new Set<string>();
  const sources: ScrapedSource[] = [];

  // Snippets that we don't need to scrape: keep the extracted facts.
  const skipScrape = scored.filter((s) => s.canSkipScrape && s.priority >= WAVE2_MIN_PRIORITY);
  for (const s of skipScrape) {
    if (seen.has(s.link)) continue;
    seen.add(s.link);
    sources.push(snippetToVirtualSource(s));
  }
  if (skipScrape.length) {
    log.info(`Kept ${skipScrape.length} snippet-only sources (canSkipScrape)`);
  }

  // Wave 1 — critical priority
  const wave1 = scored.filter(
    (s) => !s.canSkipScrape && s.priority >= WAVE1_MIN_PRIORITY && !seen.has(s.link),
  );
  log.info(`Scrape wave 1: ${wave1.length} URLs (priority ≥ ${WAVE1_MIN_PRIORITY})`);
  if (wave1.length) {
    const wave1Targets = wave1.slice(0, MAX_SCRAPE_TARGETS - sources.length);
    const wave1Out = await scrapePool(wave1Targets, concurrency, log);
    for (const s of wave1Out) {
      if (seen.has(s.url)) continue;
      seen.add(s.url);
      sources.push(s);
    }
  }

  // Wave 2 — medium priority, only if we still have headroom
  const remaining = MAX_SCRAPE_TARGETS - sources.length;
  if (remaining > 0) {
    const wave2 = scored.filter(
      (s) =>
        !s.canSkipScrape &&
        s.priority >= WAVE2_MIN_PRIORITY &&
        s.priority < WAVE1_MIN_PRIORITY &&
        !seen.has(s.link),
    );
    log.info(`Scrape wave 2: ${wave2.length} URLs (priority ≥ ${WAVE2_MIN_PRIORITY}, headroom ${remaining})`);
    if (wave2.length) {
      const wave2Targets = wave2.slice(0, remaining);
      const wave2Out = await scrapePool(wave2Targets, concurrency, log);
      for (const s of wave2Out) {
        if (seen.has(s.url)) continue;
        seen.add(s.url);
        sources.push(s);
      }
    }
  }

  // Final ordering: highest priority first
  sources.sort((a, b) => b.priority - a.priority);
  log.info(`scrapeWaves produced ${sources.length} sources total`);
  return sources;
}
