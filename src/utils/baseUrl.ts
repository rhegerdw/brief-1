import { FLAGS } from "../config/env.js";

export function getPublicBaseUrl(): string {
  if (FLAGS.publicBaseUrl) return FLAGS.publicBaseUrl.replace(/\/$/, "");
  const envUrl = process.env.VERCEL_URL; // set by Vercel, e.g., my-app.vercel.app
  if (envUrl) return `https://${envUrl.replace(/\/$/, "")}`;
  return "http://localhost:3000";
}
