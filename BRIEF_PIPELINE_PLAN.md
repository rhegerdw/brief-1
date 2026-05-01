# Plan: Rebuild `buildMeetingBrief` Research Pipeline

## Context

The original `rrh1441/meetingbrief` repo has a battle-tested 2600-line `MeetingBriefGeminiPipeline.ts` that researches a person via LinkedIn (Harvest API) and the web (Serper + Firecrawl), then generates a structured HTML brief with citations. This was a Next.js SaaS app where users typed in a name from a Calendly invite.

We're rebuilding this for the new `brief` repo which is triggered by HubSpot webhooks. Our advantage: we already have the person's name, company, domain, email, and potentially their **LinkedIn URL** from HubSpot — so we can skip expensive search steps when that data is available.

The current codebase has the full HubSpot webhook → 8-step pipeline → HubSpot Note + Slack DM scaffold working, but Step 5 (`generateMeetingBrief`) is a placeholder returning stub HTML.

## Approach

Split the original monolith into focused modules under `src/brief/`. Port the proven logic (prompts, filtering, domain blocklists) faithfully. Make it LLM-agnostic. Wire HubSpot's LinkedIn URL through the pipeline.

## Pre-requisite: Fix Supabase Import Issue

Both `src/ai/openaiClient.ts` and `src/ai/geminiClient.ts` import from `src/integrations/supabase/client.ts` which was deleted. Create a no-op stub so they don't crash at import time. The LRU fallback cache already handles the Supabase-down case.

**File:** `src/integrations/supabase/client.ts`
- Export a `supabaseAdmin` stub with a `rpc()` method that always returns `{ data: null, error: { message: 'Supabase not configured' } }`
- This lets both AI clients fall through to their LRU cache fallback without code changes

## New Files

### 1. `src/ai/llm.ts` — LLM Abstraction

Thin wrapper over existing `cachedChatCompletion` (OpenAI) and `cachedGeminiCompletion` (Gemini). Single entry point:

```typescript
export async function llmJSON<T>(opts: {
  system: string;
  user: string;
  tier: 'fast' | 'quality';  // fast = Gemini Flash / gpt-4o-mini, quality = Gemini Pro / gpt-4o
}): Promise<{ data: T; usage: { prompt_tokens: number; completion_tokens: number } }>
```

**Provider selection:** Check `GOOGLE_API_KEY` first (cheapest). Fall back to `OPENAI_API_KEY`. Both already exist and have caching. No new dependencies needed.

### 2. `src/brief/types.ts` — Brief-Specific Types

```
BriefInput    { name, org, linkedinUrl?, domain?, email? }
BriefOutput   { brief_html, citations[], metrics{}, sources[] }
SearchHit     { title, link, snippet?, query }
ScrapedSource { url, title, content, priority }
BriefJSON     { executive, highlights, funFacts, researchNotes } (LLM output schema)
```

### 3. `src/brief/constants.ts` — Domain Blocklists & Caps

Port verbatim from original:
- `BLOCKED_DOMAINS` — ~40 social sites, data brokers, personal info aggregators
- `LOW_TRUST_DOMAINS` — ZoomInfo, RocketReach, etc.
- `MAX_CONTENT_PER_SOURCE = 3500`
- `MAX_SOURCES_TO_LLM = 15`

### 4. `src/integrations/firecrawl/client.ts` — Firecrawl Scraper

Follow serper client pattern. POST to `https://api.firecrawl.dev/v1/scrape`. Uses shared `http` axios instance (gets retry logic for free).

```typescript
export async function firecrawlScrape(url: string, timeoutMs?: number): Promise<string | null>
```

Returns extracted text content or null on failure.

### 5. `src/brief/linkedin.ts` — LinkedIn Resolution

```typescript
export async function resolveLinkedIn(input: BriefInput, log): Promise<LinkedInResult>
```

**Flow:**
1. If `input.linkedinUrl` provided (from HubSpot) → skip search, go straight to `fetchProfile(url)`. This is our key optimization.
2. Otherwise → `enrichPerson(firstName, lastName, org)` (existing Harvest client does search + fetch).
3. If profile found → extract job timeline, education timeline, prior companies, publication URLs.
4. **Company verification via LLM** — port the original's prompt that checks if the profile actually works at the target company (handles abbreviations, subsidiaries, parent cos).

### 6. `src/brief/search.ts` — Parallel Web Searches

```typescript
export async function runSearches(name, org, priorCompanies, log): Promise<SearchHit[]>
```

5 parallel Serper queries (ported from original):
1. `"name" "org"` — primary
2. `"name" "org" linkedin` — LinkedIn content
3. `"name" "org" interview OR podcast OR conference` — speaking/content
4. `"name" "org" award OR recognition OR achievement` — achievements
5. `"name" joins OR appointed OR "new role"` — job changes

Then up to 3 prior-company searches from LinkedIn history. Deduplicate by URL.

### 7. `src/brief/triage.ts` — LLM Snippet Scoring

```typescript
export async function triageResults(hits, name, org, knownCompanies, log): Promise<ScoredSnippet[]>
```

Port the original's triage prompt. Batch snippets to LLM (fast tier). Each gets: priority 1-10, canSkipScrape, extractedFacts. Filters blocked/low-trust domains. Handles name disambiguation using known companies from LinkedIn.

### 8. `src/brief/scrape.ts` — Wave-Based Scraping

```typescript
export async function scrapeWaves(scored, log): Promise<ScrapedSource[]>
```

Two waves: priority ≥7 (critical), then ≥4 (medium). Concurrency limited to `FIRECRAWL_MAX_CONCURRENCY` (default 2). Skip `canSkipScrape` results — use extracted facts instead. Cap content at 3500 chars per source.

### 9. `src/brief/generate.ts` — LLM Brief Generation + HTML

```typescript
export async function generateBrief(sources, name, org, jobTimeline, eduTimeline, linkedinUrl, log): Promise<BriefOutput>
```

Port the original's generation prompt (quality tier LLM). Produces structured JSON:
- `executive`: 2-3 sentences
- `highlights`: 3-5 bullets
- `funFacts`: 1-3 items
- `researchNotes`: 4-6 items

Then renders to HTML with superscript citation links. Renumbers citations to sequential order.

### 10. `src/brief/index.ts` — Main Entry Point

```typescript
export async function buildMeetingBrief(name, org, opts?): Promise<BriefOutput>
```

Orchestrates: resolveLinkedIn → runSearches → triageResults → scrapeWaves → generateBrief.

## Modified Files

### 11. `src/integrations/hubspot/client.ts`
Add `hs_linkedin_url` to the properties string in `fetchContact()` (line 35).

### 12. `src/pipeline/types.ts`
Add `linkedinUrl?: string` to `HubSpotEventData`.

### 13. `api/webhooks/hubspot.ts`
Pass `contact.properties.hs_linkedin_url` into `eventData.linkedinUrl`.

### 14. `src/pipeline/steps.ts`
Replace Step 5 placeholder with call to `buildMeetingBrief(ctx.attendeeName, ctx.orgName, { linkedinUrl, domain, email })`.

## Implementation Order

1. **Foundation**: Supabase stub, `src/ai/llm.ts`, `src/brief/types.ts`, `src/brief/constants.ts`
2. **Clients**: `src/integrations/firecrawl/client.ts`
3. **HubSpot changes**: Add `hs_linkedin_url` to client, types, webhook (3 small edits)
4. **Research modules**: `linkedin.ts`, `search.ts`, `triage.ts`, `scrape.ts`
5. **Generation**: `generate.ts`, `index.ts`
6. **Integration**: Replace Step 5 in `steps.ts`

## What Gets Ported Verbatim vs Simplified

**Port faithfully** (core IP):
- All LLM prompts (company verification, triage scoring, brief generation)
- Domain blocklists and low-trust lists
- The 5 search query templates
- Citation renumbering algorithm
- Content truncation logic (3500 chars, 15 sources)
- HTML rendering structure (Executive Summary, Job History, Highlights & Fun Facts, Research Notes, LinkedIn link)

**Simplify**:
- LinkedIn resolution — HubSpot URL shortcut eliminates most of the original's complexity
- Wave scraping — 2 waves instead of 3 (low-priority wave rarely useful)
- Job change detection — fold into triage prompt instead of separate step
- LLM profile selection — not needed when HubSpot provides URL; simpler fallback via `enrichPerson`

## Verification

1. `npx tsc --noEmit` — must compile clean
2. Manual test: `POST /api/webhooks/hubspot` with a test contact payload → verify full pipeline runs, HubSpot Note created with real brief HTML, Slack DM sent
3. Test with and without `hs_linkedin_url` on the contact to verify both paths (direct fetch vs. Harvest search)
