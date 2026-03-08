import { GoogleGenerativeAI, GenerateContentResult } from "@google/generative-ai";
import crypto from "node:crypto";
import { LRUCache } from "lru-cache";
import { ENV } from "../config/env.js";
import { supabaseAdmin } from "../integrations/supabase/client.js";

interface CacheEntry {
  response: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

const DEFAULT_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_FALLBACK_CACHE_SIZE = 500;

const fallbackCache = new LRUCache<string, CacheEntry>({
  max: MAX_FALLBACK_CACHE_SIZE,
  ttl: DEFAULT_CACHE_TTL_MS,
});

function generateCacheKey(model: string, prompt: string, systemPrompt?: string): string {
  const content = JSON.stringify({ model, prompt, systemPrompt });
  return crypto.createHash("sha256").update(content).digest("hex");
}

async function getCachedResponse(key: string): Promise<CacheEntry | null> {
  try {
    const { data, error } = await supabaseAdmin.rpc('get_llm_cache', { p_key: key });
    if (error) {
      console.warn('[Gemini Cache] Supabase get failed, using fallback:', error.message);
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
    console.warn('[Gemini Cache] Exception on get, using fallback:', message);
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
      console.warn('[Gemini Cache] Supabase set failed, using fallback:', error.message);
      fallbackCache.set(key, { response, usage }, { ttl: ttlMs });
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn('[Gemini Cache] Exception on set, using fallback:', message);
    fallbackCache.set(key, { response, usage }, { ttl: ttlMs });
  }
}

export const gemini = ENV.GOOGLE_API_KEY
  ? new GoogleGenerativeAI(ENV.GOOGLE_API_KEY)
  : null;

export interface UsageContext {
  entity_type?: string;
  entity_id?: string;
  meeting_id?: string;
  company_id?: string;
  listing_id?: string;
  pipeline?: string;
  step?: string;
}

export interface CachedGeminiOptions {
  model: string;
  systemPrompt?: string;
  prompt: string;
  temperature?: number;
  responseType?: 'text' | 'json';
  ctx?: UsageContext;
  cacheTtlMs?: number;
  skipCache?: boolean;
}

export interface CachedGeminiResult {
  content: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  cached: boolean;
  latency_ms: number;
}

export async function cachedGeminiCompletion(options: CachedGeminiOptions): Promise<CachedGeminiResult> {
  if (!gemini) {
    throw new Error("GOOGLE_API_KEY not configured");
  }

  const { model, systemPrompt, prompt, temperature, responseType, ctx, cacheTtlMs, skipCache } = options;

  const cacheKey = generateCacheKey(model, prompt, systemPrompt);

  if (!skipCache) {
    const cached = await getCachedResponse(cacheKey);
    if (cached) {
      console.log(`[Gemini Cache] HIT for ${model} (${cacheKey.slice(0, 8)}...)`);
      return {
        content: cached.response,
        usage: cached.usage,
        cached: true,
        latency_ms: 0,
      };
    }
  }

  const t0 = Date.now();

  const generativeModel = gemini.getGenerativeModel({
    model,
    ...(systemPrompt && { systemInstruction: systemPrompt }),
    generationConfig: {
      ...(temperature !== undefined && { temperature }),
      ...(responseType === 'json' && { responseMimeType: "application/json" }),
    },
  });

  const result: GenerateContentResult = await generativeModel.generateContent(prompt);
  const latency_ms = Date.now() - t0;

  const response = result.response;
  const content = response.text();

  const usageMetadata = response.usageMetadata;
  const usage = {
    prompt_tokens: usageMetadata?.promptTokenCount ?? 0,
    completion_tokens: usageMetadata?.candidatesTokenCount ?? 0,
    total_tokens: usageMetadata?.totalTokenCount ?? 0,
  };

  if (!skipCache) {
    await setCachedResponse(cacheKey, content, usage, cacheTtlMs);
    console.log(`[Gemini Cache] MISS for ${model} (${cacheKey.slice(0, 8)}...), stored for ${(cacheTtlMs || DEFAULT_CACHE_TTL_MS) / 1000}s`);
  }

  return {
    content,
    usage,
    cached: false,
    latency_ms,
  };
}

export const GEMINI_MODELS = {
  FLASH: "gemini-2.5-flash",
  PRO: "gemini-2.5-pro",
} as const;
