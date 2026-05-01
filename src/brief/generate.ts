/**
 * LLM brief generation + HTML rendering.
 *
 * Asks the quality-tier LLM for structured JSON (executive / highlights /
 * funFacts / researchNotes) with citation indices that point into the input
 * sources array. We then renumber citations to a sequential 1..N order based
 * on first appearance in the rendered HTML and produce the final HTML brief.
 *
 * HTML structure mirrors the original meetingbrief renderer:
 *   <h2>Meeting Brief: {Person} — {Org}</h2>
 *   <h3>Executive Summary</h3>
 *   <h3>Job History</h3>          (job + edu timeline)
 *   <h3>Highlights & Fun Facts</h3>
 *   <h3>Research Notes</h3>
 *   <h3>Sources</h3>
 *   <p><a href="...">LinkedIn</a></p>
 */

import { llmJSON } from '../ai/llm.js';
import type { PipelineLogger } from '../pipeline/types.js';
import {
  MAX_CONTENT_PER_SOURCE,
  MAX_SOURCES_TO_LLM,
} from './constants.js';
import type {
  BriefBullet,
  BriefCitation,
  BriefJSON,
  BriefMetrics,
  BriefOutput,
  EduTimelineEntry,
  JobTimelineEntry,
  ScrapedSource,
} from './types.js';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function trimSourceForPrompt(src: ScrapedSource): string {
  const body = src.content.length > MAX_CONTENT_PER_SOURCE
    ? src.content.slice(0, MAX_CONTENT_PER_SOURCE)
    : src.content;
  return `URL: ${src.url}
Title: ${src.title}
Content:
${body}`;
}

function buildPrompts(
  name: string,
  org: string,
  jobTimeline: JobTimelineEntry[],
  sources: ScrapedSource[],
): { system: string; user: string } {
  const system = `You write concise, factual meeting-prep briefs for a salesperson preparing to meet a specific person at a specific company. You always cite sources. Every claim that is not common knowledge MUST cite at least one source by its 1-based index in the provided list. Only cite sources that genuinely support the claim. Never invent citations or facts.

Output strict JSON, no prose outside the JSON. Schema:
{
  "executive": "<2-3 sentences summarizing who this person is, their current role at the target company, and what is most relevant for the meeting>",
  "highlights": [
    { "text": "<1 bullet>", "citations": [<1-based indices>] }
  ],
  "funFacts": [
    { "text": "<personal/colorful detail>", "citations": [<indices>] }
  ],
  "researchNotes": [
    { "text": "<background note for the rep>", "citations": [<indices>] }
  ]
}

Rules:
- 3–5 highlights. 1–3 funFacts (omit list entirely if nothing colorful exists). 4–6 researchNotes.
- Each bullet must cite at least one source UNLESS it is from the provided LinkedIn job timeline (which the rep already trusts).
- Prefer recent, specific facts (titles, deals, awards, quotes) over generic ones.
- Do NOT hallucinate. If sources don't support a claim, omit it.
- Keep individual bullets to one or two short sentences.
- Avoid filler like "according to sources" — just state the fact and cite.`;

  const timeline = jobTimeline.length
    ? jobTimeline
        .map((j) => {
          const span =
            j.startYear || j.endYear
              ? ` (${j.startYear ?? '?'} – ${j.endYear ?? '?'})`
              : '';
          return `- ${j.title ?? ''} @ ${j.company}${span}`;
        })
        .join('\n')
    : '(no LinkedIn timeline available)';

  const sourcesBlock = sources
    .map((s, i) => `[${i + 1}] ${trimSourceForPrompt(s)}`)
    .join('\n\n---\n\n');

  const user = `Target person: ${name}
Target company: ${org}

LinkedIn job timeline (trusted, may be cited without explicit source):
${timeline}

Sources (numbered, cite by 1-based index):
${sourcesBlock || '(no external sources scraped)'}

Produce the brief JSON now.`;

  return { system, user };
}

/**
 * Renumber citations to sequential 1..N based on first appearance, and drop
 * citations whose target source doesn't exist.
 */
function renumberCitations(
  brief: BriefJSON,
  sources: ScrapedSource[],
): { brief: BriefJSON; citations: BriefCitation[] } {
  const order: number[] = []; // original indices, in first-appearance order
  const remap = new Map<number, number>(); // original (1-based) → new (1-based)

  function track(orig: number): number | null {
    if (orig < 1 || orig > sources.length) return null;
    const existing = remap.get(orig);
    if (existing) return existing;
    order.push(orig);
    const next = order.length;
    remap.set(orig, next);
    return next;
  }

  function remapList(list: BriefBullet[]): BriefBullet[] {
    return list.map((b) => ({
      text: b.text,
      citations: (b.citations || [])
        .map((c) => track(c))
        .filter((c): c is number => c !== null),
    }));
  }

  const newBrief: BriefJSON = {
    executive: brief.executive,
    highlights: remapList(brief.highlights || []),
    funFacts: remapList(brief.funFacts || []),
    researchNotes: remapList(brief.researchNotes || []),
  };

  const citations: BriefCitation[] = order.map((orig, i) => {
    const src = sources[orig - 1];
    const cite: BriefCitation = {
      index: i + 1,
      url: src.url,
    };
    if (src.title) cite.title = src.title;
    return cite;
  });

  return { brief: newBrief, citations };
}

function renderCitations(cs: number[]): string {
  if (!cs.length) return '';
  const links = cs
    .map((c) => `<a href="#brief-cite-${c}">${c}</a>`)
    .join(',');
  return `<sup>[${links}]</sup>`;
}

function renderBullets(items: BriefBullet[]): string {
  if (!items.length) return '';
  return `<ul>\n${items
    .map((b) => `  <li>${escapeHtml(b.text)} ${renderCitations(b.citations)}</li>`)
    .join('\n')}\n</ul>`;
}

function renderJobTimeline(
  jobs: JobTimelineEntry[],
  edu: EduTimelineEntry[],
): string {
  const jobLines = jobs.map((j) => {
    const span =
      j.startYear || j.endYear
        ? ` <em>(${j.startYear ?? '?'} – ${j.endYear ?? '?'})</em>`
        : '';
    const title = j.title ? `${escapeHtml(j.title)} @ ` : '';
    return `  <li>${title}${escapeHtml(j.company)}${span}</li>`;
  });

  const eduLines = edu.map((e) => {
    const span =
      e.startYear || e.endYear
        ? ` <em>(${e.startYear ?? '?'} – ${e.endYear ?? '?'})</em>`
        : '';
    const degree = e.degree ? `${escapeHtml(e.degree)}, ` : '';
    return `  <li>${degree}${escapeHtml(e.school)}${span}</li>`;
  });

  let out = '';
  if (jobLines.length) {
    out += `<h4>Experience</h4>\n<ul>\n${jobLines.join('\n')}\n</ul>`;
  }
  if (eduLines.length) {
    out += `\n<h4>Education</h4>\n<ul>\n${eduLines.join('\n')}\n</ul>`;
  }
  return out || '<p><em>No LinkedIn timeline available.</em></p>';
}

function renderSources(citations: BriefCitation[]): string {
  if (!citations.length) return '';
  const items = citations
    .map((c) => {
      const label = escapeHtml(c.title || c.url);
      return `  <li id="brief-cite-${c.index}">[${c.index}] <a href="${escapeHtml(c.url)}">${label}</a></li>`;
    })
    .join('\n');
  return `<h3>Sources</h3>\n<ol>\n${items}\n</ol>`;
}

function renderHtml(
  name: string,
  org: string,
  brief: BriefJSON,
  jobTimeline: JobTimelineEntry[],
  eduTimeline: EduTimelineEntry[],
  citations: BriefCitation[],
  linkedinUrl?: string,
): string {
  const linkedInBlock = linkedinUrl
    ? `<p><strong>LinkedIn:</strong> <a href="${escapeHtml(linkedinUrl)}">${escapeHtml(linkedinUrl)}</a></p>`
    : '';

  const exec = brief.executive
    ? `<p>${escapeHtml(brief.executive)}</p>`
    : '<p><em>No executive summary available.</em></p>';

  const highlights = brief.highlights.length
    ? renderBullets(brief.highlights)
    : '<p><em>No highlights generated.</em></p>';

  const funFacts = brief.funFacts.length
    ? `<h4>Fun Facts</h4>\n${renderBullets(brief.funFacts)}`
    : '';

  const notes = brief.researchNotes.length
    ? renderBullets(brief.researchNotes)
    : '<p><em>No research notes generated.</em></p>';

  return [
    `<h2>Meeting Brief: ${escapeHtml(name)} — ${escapeHtml(org)}</h2>`,
    linkedInBlock,
    `<h3>Executive Summary</h3>`,
    exec,
    `<h3>Job History</h3>`,
    renderJobTimeline(jobTimeline, eduTimeline),
    `<h3>Highlights &amp; Fun Facts</h3>`,
    highlights,
    funFacts,
    `<h3>Research Notes</h3>`,
    notes,
    renderSources(citations),
  ]
    .filter(Boolean)
    .join('\n');
}

function emptyBrief(reason: string): BriefJSON {
  return {
    executive: reason,
    highlights: [],
    funFacts: [],
    researchNotes: [],
  };
}

export interface GenerateBriefArgs {
  sources: ScrapedSource[];
  name: string;
  org: string;
  jobTimeline: JobTimelineEntry[];
  eduTimeline: EduTimelineEntry[];
  linkedinUrl?: string;
  startedAt: number;
  searchHits: number;
  scoredHits: number;
  hasLinkedIn: boolean;
  linkedinFromInput: boolean;
  log: PipelineLogger;
}

export async function generateBrief(args: GenerateBriefArgs): Promise<BriefOutput> {
  const {
    sources,
    name,
    org,
    jobTimeline,
    eduTimeline,
    linkedinUrl,
    startedAt,
    searchHits,
    scoredHits,
    hasLinkedIn,
    linkedinFromInput,
    log,
  } = args;

  const truncatedSources = sources.slice(0, MAX_SOURCES_TO_LLM);

  // Special case: nothing to send to the LLM and no LinkedIn data either —
  // emit a minimal HTML brief so the pipeline still produces a usable note.
  if (truncatedSources.length === 0 && jobTimeline.length === 0) {
    log.warn('No sources or LinkedIn data — emitting empty brief');
    const empty = emptyBrief(
      `No public information found about ${name} at ${org}. Consider checking the contact's LinkedIn URL on the HubSpot record.`,
    );
    const html = renderHtml(name, org, empty, jobTimeline, eduTimeline, [], linkedinUrl);
    const metrics: BriefMetrics = {
      searchHits,
      scoredHits,
      scrapedSources: 0,
      promptTokens: 0,
      completionTokens: 0,
      durationMs: Date.now() - startedAt,
      hasLinkedIn,
      linkedinFromInput,
    };
    return {
      brief_html: html,
      citations: [],
      metrics,
      sources: [],
    };
  }

  const { system, user } = buildPrompts(name, org, jobTimeline, truncatedSources);

  let briefJson: BriefJSON;
  let provider: string | undefined;
  let promptTokens = 0;
  let completionTokens = 0;
  try {
    const res = await llmJSON<BriefJSON>({
      system,
      user,
      tier: 'quality',
      temperature: 0.2,
      ctx: { pipeline: 'brief', step: 'generate' },
    });
    briefJson = {
      executive: res.data.executive ?? '',
      highlights: Array.isArray(res.data.highlights) ? res.data.highlights : [],
      funFacts: Array.isArray(res.data.funFacts) ? res.data.funFacts : [],
      researchNotes: Array.isArray(res.data.researchNotes) ? res.data.researchNotes : [],
    };
    provider = res.provider;
    promptTokens = res.usage.prompt_tokens;
    completionTokens = res.usage.completion_tokens;
  } catch (e) {
    log.error('Brief generation LLM failed', e);
    briefJson = emptyBrief(`Brief generation failed for ${name} at ${org}.`);
  }

  const { brief: renumbered, citations } = renumberCitations(briefJson, truncatedSources);
  const html = renderHtml(name, org, renumbered, jobTimeline, eduTimeline, citations, linkedinUrl);

  const metrics: BriefMetrics = {
    searchHits,
    scoredHits,
    scrapedSources: truncatedSources.length,
    promptTokens,
    completionTokens,
    durationMs: Date.now() - startedAt,
    hasLinkedIn,
    linkedinFromInput,
  };
  if (provider) metrics.llmProvider = provider;

  return {
    brief_html: html,
    citations,
    metrics,
    sources: truncatedSources.map((s) => {
      const out: { url: string; title?: string } = { url: s.url };
      if (s.title) out.title = s.title;
      return out;
    }),
  };
}
