import { http } from "../../utils/axiosClient.js";
import { ENV } from "../../config/env.js";

const BASE = "https://api.calendly.com";

function headers() {
  return { Authorization: `Bearer ${ENV.CALENDLY_API_KEY}` } as Record<string, string>;
}

export async function calendlyMe() {
  const res = await http.get(`${BASE}/users/me`, { headers: headers() });
  return res.data;
}

export async function scheduledEvents(params: { user?: string; organization?: string; min_start_time?: string; max_start_time?: string }) {
  const res = await http.get(`${BASE}/scheduled_events`, { headers: headers(), params });
  return res.data;
}

export async function eventInvitees(eventIdOrUri: string) {
  let uuid = eventIdOrUri;
  const m = /\/scheduled_events\/([a-f0-9\-]{36})/i.exec(eventIdOrUri);
  if (m) uuid = m[1];
  const res = await http.get(`${BASE}/scheduled_events/${uuid}/invitees`, { headers: headers() });
  return res.data;
}

export async function eventByUri(uri: string) {
  const res = await http.get(uri, { headers: headers() });
  return res.data;
}

/**
 * Extract invitee name from Calendly invitee object.
 * Handles both legacy 'name' field and new 'first_name'/'last_name' fields.
 */
export function getInviteeName(invitee: any): string {
  if (invitee?.name) return invitee.name;
  if (invitee?.first_name && invitee?.last_name) {
    return `${invitee.first_name} ${invitee.last_name}`.trim();
  }
  return (invitee?.first_name || invitee?.last_name || '').trim();
}
