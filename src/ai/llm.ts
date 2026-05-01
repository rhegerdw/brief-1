/**
 * LLM abstraction — single entry point for the brief pipeline.
 *
 * Selects a provider at runtime: Gemini (cheaper) when GOOGLE_API_KEY is set,
 * otherwise OpenAI. Wraps the existing cached completion helpers so we keep
 * the LRU cache + token logging behaviour for free.
 */

import { ENV } from '../config/env.js';
import {
  cachedChatCompletion,
  type UsageContext,
} from './openaiClient.js';
import {
  cachedGeminiCompletion,
  GEMINI_MODELS,
} from './geminiClient.js';

export type LLMTier = 'fast' | 'quality';

export interface LLMJSONOptions {
  system: string;
  user: string;
  tier: LLMTier;
  temperature?: number;
  ctx?: UsageContext;
}

export interface LLMJSONResult<T> {
  data: T;
  raw: string;
  usage: { prompt_tokens: number; completion_tokens: number };
  provider: 'gemini' | 'openai';
}

const OPENAI_MODELS = {
  fast: 'gpt-4o-mini',
  quality: 'gpt-4o',
} as const;

function stripJsonFences(text: string): string {
  let s = text.trim();
  // Strip ``` fences if present
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  }
  return s;
}

function tryParseJson<T>(raw: string): T {
  const cleaned = stripJsonFences(raw);
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Attempt to extract the largest JSON object/array substring
    const objStart = cleaned.indexOf('{');
    const arrStart = cleaned.indexOf('[');
    const start = (objStart === -1)
      ? arrStart
      : (arrStart === -1 ? objStart : Math.min(objStart, arrStart));
    const objEnd = cleaned.lastIndexOf('}');
    const arrEnd = cleaned.lastIndexOf(']');
    const end = Math.max(objEnd, arrEnd);
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1)) as T;
    }
    throw new Error(`Failed to parse LLM JSON output: ${cleaned.slice(0, 200)}`);
  }
}

/**
 * Send a structured-JSON request to the configured LLM provider.
 * Throws if neither GOOGLE_API_KEY nor OPENAI_API_KEY is configured.
 */
export async function llmJSON<T>(opts: LLMJSONOptions): Promise<LLMJSONResult<T>> {
  const { system, user, tier, temperature, ctx } = opts;

  if (ENV.GOOGLE_API_KEY) {
    const model = tier === 'quality' ? GEMINI_MODELS.PRO : GEMINI_MODELS.FLASH;
    const res = await cachedGeminiCompletion({
      model,
      systemPrompt: system,
      prompt: user,
      responseType: 'json',
      ...(temperature !== undefined && { temperature }),
      ...(ctx && { ctx }),
    });
    return {
      data: tryParseJson<T>(res.content),
      raw: res.content,
      usage: {
        prompt_tokens: res.usage.prompt_tokens,
        completion_tokens: res.usage.completion_tokens,
      },
      provider: 'gemini',
    };
  }

  if (ENV.OPENAI_API_KEY) {
    const model = OPENAI_MODELS[tier];
    const res = await cachedChatCompletion({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
      ...(temperature !== undefined && { temperature }),
      ...(ctx && { ctx }),
    });
    return {
      data: tryParseJson<T>(res.content),
      raw: res.content,
      usage: {
        prompt_tokens: res.usage.prompt_tokens,
        completion_tokens: res.usage.completion_tokens,
      },
      provider: 'openai',
    };
  }

  throw new Error('No LLM provider configured (set GOOGLE_API_KEY or OPENAI_API_KEY)');
}

/**
 * Free-form text completion. Used for narrative generation where strict JSON
 * isn't required. Falls back through the same provider hierarchy.
 */
export async function llmText(opts: LLMJSONOptions): Promise<{
  text: string;
  usage: { prompt_tokens: number; completion_tokens: number };
  provider: 'gemini' | 'openai';
}> {
  const { system, user, tier, temperature, ctx } = opts;

  if (ENV.GOOGLE_API_KEY) {
    const model = tier === 'quality' ? GEMINI_MODELS.PRO : GEMINI_MODELS.FLASH;
    const res = await cachedGeminiCompletion({
      model,
      systemPrompt: system,
      prompt: user,
      ...(temperature !== undefined && { temperature }),
      ...(ctx && { ctx }),
    });
    return {
      text: res.content,
      usage: {
        prompt_tokens: res.usage.prompt_tokens,
        completion_tokens: res.usage.completion_tokens,
      },
      provider: 'gemini',
    };
  }

  if (ENV.OPENAI_API_KEY) {
    const model = OPENAI_MODELS[tier];
    const res = await cachedChatCompletion({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      ...(temperature !== undefined && { temperature }),
      ...(ctx && { ctx }),
    });
    return {
      text: res.content,
      usage: {
        prompt_tokens: res.usage.prompt_tokens,
        completion_tokens: res.usage.completion_tokens,
      },
      provider: 'openai',
    };
  }

  throw new Error('No LLM provider configured (set GOOGLE_API_KEY or OPENAI_API_KEY)');
}
