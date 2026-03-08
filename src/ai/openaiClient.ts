import OpenAI from "openai";
import crypto from "node:crypto";
import { LRUCache } from "lru-cache";
import { ENV } from "../config/env.js";
import { supabaseAdmin } from "../integrations/supabase/client.js";

interface CacheEntry {
  response: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

// In-memory fallback cache
const DEFAULT_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_FALLBACK_CACHE_SIZE = 500;

const fallbackCache = new LRUCache<string, CacheEntry>({
  max: MAX_FALLBACK_CACHE_SIZE,
  ttl: DEFAULT_CACHE_TTL_MS,
});

function generateCacheKey(model: string, messages: Array<{ role: string; content: string }>): string {
  const content = JSON.stringify({ model, messages });
  return crypto.createHash("sha256").update(content).digest("hex");
}

async function getCachedResponse(key: string): Promise<CacheEntry | null> {
  try {
    const { data, error } = await supabaseAdmin.rpc('get_llm_cache', { p_key: key });
    if (error) {
      console.warn('[LLM Cache] Supabase get failed, using fallback:', error.message);
      return fallbackCache.get(key) ?? null;
    }
    if (!data || data.length === 0) {
      return fallbackCache.get(key) ?? null;
    }
    const row = data[0];
    return {
      response: row.response,
      usage: {
        prompt_tokens: row.usage_prompt_tokens,
        completion_tokens: row.usage_completion_tokens,
        total_tokens: row.usage_total_tokens,
      },
    };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn('[LLM Cache] Exception on get, using fallback:', message);
    return fallbackCache.get(key) ?? null;
  }
}

async function setCachedResponse(key: string, response: string, usage: CacheEntry['usage'], ttlMs: number = DEFAULT_CACHE_TTL_MS): Promise<void> {
  try {
    const { error } = await supabaseAdmin.rpc('set_llm_cache', {
      p_key: key,
      p_response: response,
      p_prompt_tokens: usage.prompt_tokens,
      p_completion_tokens: usage.completion_tokens,
      p_total_tokens: usage.total_tokens,
      p_ttl_ms: ttlMs,
    });
    if (error) {
      console.warn('[LLM Cache] Supabase set failed, using fallback:', error.message);
      fallbackCache.set(key, { response, usage }, { ttl: ttlMs });
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn('[LLM Cache] Exception on set, using fallback:', message);
    fallbackCache.set(key, { response, usage }, { ttl: ttlMs });
  }
}

export function clearLlmCache(): void {
  fallbackCache.clear();
}

export function getLlmCacheStats(): { size: number; maxSize: number } {
  return { size: fallbackCache.size, maxSize: MAX_FALLBACK_CACHE_SIZE };
}

export const openai = new OpenAI({ apiKey: ENV.OPENAI_API_KEY });

export interface UsageContext {
  entity_type?: string;
  entity_id?: string;
  meeting_id?: string;
  company_id?: string;
  listing_id?: string;
  pipeline?: string;
  step?: string;
}

export async function logUsage(params: {
  model: string;
  prompt: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
  latency_ms?: number;
  ctx?: UsageContext;
}) {
  const { model, prompt, usage, latency_ms, ctx } = params;
  const promptHash = crypto.createHash("sha256").update(prompt).digest("hex").slice(0, 32);
  const pt = usage?.prompt_tokens ?? 0;
  const ct = usage?.completion_tokens ?? 0;
  const payload = {
    model,
    tokens_in: pt,
    tokens_out: ct,
    cost_usd: 0,
    latency_ms: latency_ms ?? null,
    prompt_hash: promptHash,
    meta: ctx ?? null,
  };
  try {
    await supabaseAdmin.rpc("log_llm_usage", { p: payload as unknown as Record<string, unknown> });
  } catch (e) {
    console.warn('[LLM Usage] Failed to log:', e);
  }
}

export interface CachedCompletionOptions {
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  response_format?: { type: 'json_object' | 'text' };
  temperature?: number;
  ctx?: UsageContext;
  cacheTtlMs?: number;
  skipCache?: boolean;
}

export interface CachedCompletionResult {
  content: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  cached: boolean;
  latency_ms: number;
}

export async function cachedChatCompletion(options: CachedCompletionOptions): Promise<CachedCompletionResult> {
  const { model, messages, response_format, temperature, ctx, cacheTtlMs, skipCache } = options;

  const cacheKey = generateCacheKey(model, messages);

  if (!skipCache) {
    const cached = await getCachedResponse(cacheKey);
    if (cached) {
      console.log(`[LLM Cache] HIT for ${model} (${cacheKey.slice(0, 8)}...)`);
      return {
        content: cached.response,
        usage: cached.usage,
        cached: true,
        latency_ms: 0,
      };
    }
  }

  const t0 = Date.now();
  const resp = await openai.chat.completions.create({
    model,
    messages,
    ...(response_format && { response_format }),
    ...(temperature !== undefined && { temperature }),
  });
  const latency_ms = Date.now() - t0;

  const completion = resp as OpenAI.Chat.ChatCompletion;
  const content = completion.choices?.[0]?.message?.content || '';
  const usage = {
    prompt_tokens: completion.usage?.prompt_tokens || 0,
    completion_tokens: completion.usage?.completion_tokens || 0,
    total_tokens: completion.usage?.total_tokens || 0,
  };

  const promptText = messages.map(m => m.content).join('\n');
  await logUsage({
    model,
    prompt: promptText,
    usage,
    latency_ms,
    ctx,
  });

  if (!skipCache) {
    await setCachedResponse(cacheKey, content, usage, cacheTtlMs);
    console.log(`[LLM Cache] MISS for ${model} (${cacheKey.slice(0, 8)}...), stored for ${(cacheTtlMs || DEFAULT_CACHE_TTL_MS) / 1000}s`);
  }

  return {
    content,
    usage,
    cached: false,
    latency_ms,
  };
}
