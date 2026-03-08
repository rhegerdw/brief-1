import { z } from "zod";

const EnvSchema = z.object({
  // Database (Required)
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(10),

  // Calendar: Calendly
  CALENDLY_SIGNING_SECRET: z.string().optional(),
  CALENDLY_API_KEY: z.string().optional(),

  // Calendar: Google
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),

  // Calendar: Apps Script
  APPS_SCRIPT_SECRET: z.string().optional(),

  // Slack
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_SIGNING_SECRET: z.string().optional(),
  SLACK_CEO_USER_ID: z.string().optional(),
  SLACK_OPS_CHANNEL_ID: z.string().optional(),
  SLACK_BRIEF_CHANNEL_ID: z.string().optional(),

  // AI/LLM
  OPENAI_API_KEY: z.string().min(10),
  ANTHROPIC_API_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),

  // Research APIs
  SERPER_API_KEY: z.string().optional(),
  SERPER_KEY: z.string().optional(), // Alternative name
  FIRECRAWL_KEY: z.string().optional(),
  FIRECRAWL_MAX_CONCURRENCY: z.string().optional(),
  HARVEST_API_KEY: z.string().optional(),
  HARVEST_BASE: z.string().optional(),

  // App Config
  PUBLIC_BASE_URL: z.string().optional(),
  INTERNAL_DOMAINS: z.string().optional(), // Comma-separated internal domains for Google Calendar filtering
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): Env {
  const merged = { ...process.env, ...overrides } as Record<string, string>;
  const parsed = EnvSchema.safeParse(merged);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `- ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Missing or invalid environment variables:\n${issues}\n\n` +
        `Set required vars or update config/env.ts if names changed.`
    );
  }
  return parsed.data;
}

export const ENV = loadEnv();

export const FLAGS = {
  publicBaseUrl: process.env.PUBLIC_BASE_URL,
  slackEnabled: (process.env.SLACK_ENABLED ?? 'true').toLowerCase() !== 'false',
};
