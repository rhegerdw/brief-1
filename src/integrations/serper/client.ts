import { http } from "../../utils/axiosClient.js";
import { ENV } from "../../config/env.js";

export type SerperResult = {
  searchParameters?: any;
  organic?: { title: string; link: string; snippet?: string }[];
};

export async function serperSearch(query: string, opts?: { num?: number }) {
  const apiKey = ENV.SERPER_API_KEY || ENV.SERPER_KEY;
  if (!apiKey) {
    throw new Error("SERPER_API_KEY not configured");
  }
  const url = "https://google.serper.dev/search";
  const headers = { "X-API-KEY": apiKey } as Record<string, string>;
  const body = { q: query, num: Math.min(Math.max(opts?.num ?? 5, 1), 10) } as any;
  const res = await http.post(url, body, { headers });
  return res.data as SerperResult;
}
