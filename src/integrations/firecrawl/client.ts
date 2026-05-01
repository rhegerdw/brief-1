/**
 * Firecrawl scraper client.
 * Returns extracted markdown/text content for a URL, or null on failure.
 *
 * https://docs.firecrawl.dev/api-reference/endpoint/scrape
 */

import { http } from '../../utils/axiosClient.js';
import { ENV } from '../../config/env.js';

const ENDPOINT = 'https://api.firecrawl.dev/v1/scrape';

interface FirecrawlScrapeResponse {
  success?: boolean;
  data?: {
    markdown?: string;
    content?: string;
    text?: string;
    metadata?: {
      title?: string;
      description?: string;
      sourceURL?: string;
    };
  };
  error?: string;
}

export interface FirecrawlResult {
  content: string;
  title?: string;
}

/**
 * Scrape a single URL via Firecrawl. Returns null on any error so callers can
 * gracefully skip the source.
 */
export async function firecrawlScrape(
  url: string,
  timeoutMs?: number,
): Promise<FirecrawlResult | null> {
  const apiKey = ENV.FIRECRAWL_KEY;
  if (!apiKey) {
    console.warn('[Firecrawl] FIRECRAWL_KEY not configured — skipping scrape');
    return null;
  }

  try {
    const { data } = await http.post<FirecrawlScrapeResponse>(
      ENDPOINT,
      {
        url,
        formats: ['markdown'],
        onlyMainContent: true,
        timeout: timeoutMs ?? 30_000,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: (timeoutMs ?? 30_000) + 5_000,
      },
    );

    if (data.success === false) {
      console.warn(`[Firecrawl] failed for ${url}: ${data.error}`);
      return null;
    }

    const content = data.data?.markdown || data.data?.content || data.data?.text || '';
    if (!content) return null;

    return {
      content,
      title: data.data?.metadata?.title,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[Firecrawl] exception for ${url}: ${msg}`);
    return null;
  }
}
