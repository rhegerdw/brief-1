/**
 * Brief-pipeline shared types.
 */

export interface BriefInput {
  name: string;
  org: string;
  linkedinUrl?: string;
  domain?: string;
  email?: string;
}

export interface BriefSource {
  url: string;
  title?: string;
}

export interface BriefCitation {
  index: number;     // 1-based, sequential in final HTML
  url: string;
  title?: string;
}

export interface BriefMetrics {
  searchHits: number;
  scoredHits: number;
  scrapedSources: number;
  llmProvider?: string;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
  hasLinkedIn: boolean;
  linkedinFromInput: boolean;
}

export interface BriefOutput {
  brief_html: string;
  citations: BriefCitation[];
  metrics: BriefMetrics;
  sources: BriefSource[];
}

export interface SearchHit {
  title: string;
  link: string;
  snippet?: string;
  query: string;
}

export interface ScoredSnippet extends SearchHit {
  priority: number;          // 1-10
  canSkipScrape: boolean;
  extractedFacts?: string;
  domain: string;
  reason?: string;
}

export interface ScrapedSource {
  url: string;
  title: string;
  content: string;
  priority: number;
  domain: string;
  /** True when this source was not actually scraped — content is the LLM-extracted snippet facts. */
  fromSnippet?: boolean;
}

/**
 * LLM output schema for the brief generation step. Mirrors the original repo.
 */
export interface BriefJSON {
  executive: string;
  highlights: BriefBullet[];
  funFacts: BriefBullet[];
  researchNotes: BriefBullet[];
}

export interface BriefBullet {
  text: string;
  /** 1-based source indices referenced by this bullet. */
  citations: number[];
}

export interface JobTimelineEntry {
  company: string;
  title?: string;
  startYear?: number;
  endYear?: number | 'present';
  location?: string;
}

export interface EduTimelineEntry {
  school: string;
  degree?: string;
  startYear?: number;
  endYear?: number;
}
