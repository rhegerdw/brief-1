/**
 * No-op Supabase client stub.
 *
 * Both `src/ai/openaiClient.ts` and `src/ai/geminiClient.ts` import
 * `supabaseAdmin.rpc(...)` for an optional persistent LLM cache. When Supabase
 * is not configured we return a benign error so the callers fall through to
 * the in-memory LRU cache. No real database calls are made.
 *
 * The `data` shape is intentionally permissive (`any[]`) so existing callers
 * that destructure typed cache rows continue to typecheck without changes.
 */

interface RpcCacheRow {
  response: string;
  usage_prompt_tokens: number;
  usage_completion_tokens: number;
  usage_total_tokens: number;
}

interface RpcResult {
  data: RpcCacheRow[] | null;
  error: { message: string } | null;
}

const NOT_CONFIGURED: RpcResult = {
  data: null,
  error: { message: 'Supabase not configured' },
};

export const supabaseAdmin = {
  rpc(_fn: string, _params?: Record<string, unknown>): Promise<RpcResult> {
    return Promise.resolve(NOT_CONFIGURED);
  },
};
