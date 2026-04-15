import { z } from "zod";

const EnvSchema = z.object({
  // HubSpot
  HUBSPOT_ACCESS_TOKEN: z.string().min(1),
  HUBSPOT_CLIENT_SECRET: z.string().optional(),
  HUBSPOT_PORTAL_ID: z.string().optional(),

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
  SERPER_KEY: z.string().optional(),
  FIRECRAWL_KEY: z.string().optional(),
  FIRECRAWL_MAX_CONCURRENCY: z.string().optional(),
  HARVEST_API_KEY: z.string().optional(),
  HARVEST_BASE: z.string().optional(),

  // App Config
  PUBLIC_BASE_URL: z.string().optional(),
  INTERNAL_DOMAINS: z.string().optional(),
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
  hubspotEnabled: (process.env.HUBSPOT_ENABLED ?? 'true').toLowerCase() !== 'false',
};
