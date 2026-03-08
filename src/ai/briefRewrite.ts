import { cachedGeminiCompletion, GEMINI_MODELS } from "./geminiClient.js";

export async function briefRewrite(questions: string[], ctx?: { meeting_id?: string; company_id?: string }) {
  const systemPrompt = `You rewrite sales discovery questions to be concise, neutral, and professional.
Only rewrite wording. Do not change meaning. Return JSON { questions: string[] }.`;

  const userPrompt = `Original questions:\n${questions.join("\n- ")}`;

  const result = await cachedGeminiCompletion({
    model: GEMINI_MODELS.FLASH,
    systemPrompt,
    prompt: userPrompt,
    responseType: 'json',
    ctx: {
      pipeline: "prebrief_pipeline",
      step: "briefRewrite",
      meeting_id: ctx?.meeting_id,
      company_id: ctx?.company_id,
    },
  });

  let parsed: { questions: string[] } = { questions: [] };
  try {
    parsed = JSON.parse(result.content);
  } catch {
    console.warn("[briefRewrite] Failed to parse JSON response");
  }

  return parsed.questions;
}
