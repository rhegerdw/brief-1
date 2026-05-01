/**
 * Harvest API client — LinkedIn person enrichment
 * https://docs.harvest-api.com
 */

import { http } from '../../utils/axiosClient.js';

const BASE = process.env.HARVEST_BASE || 'https://api.harvest-api.com';

function headers() {
  const key = process.env.HARVEST_API_KEY;
  if (!key) throw new Error('HARVEST_API_KEY is not set');
  return { 'X-API-Key': key };
}

// ── Types ────────────────────────────────────────────────────────

export interface HarvestPosition {
  companyName?: string;
  title?: string;
  description?: string;
  location?: string;
  startedOn?: { month?: number; year?: number };
  endedOn?: { month?: number; year?: number };
  tenureAtPosition?: string;
  tenureAtCompany?: string;
}

export interface HarvestEducation {
  title?: string;
  degree?: string;
  startedOn?: { year?: number };
  endedOn?: { year?: number };
}

export interface HarvestProfile {
  id?: string;
  publicIdentifier?: string;
  firstName?: string;
  lastName?: string;
  headline?: string;
  about?: string;
  linkedinUrl?: string;
  photo?: string;
  location?: { linkedinText?: string; countryCode?: string };
  topSkills?: string[];
  connectionsCount?: number;
  followerCount?: number;
  openToWork?: boolean;
  hiring?: boolean;
  currentPosition?: HarvestPosition[];
  experience?: HarvestPosition[];
  education?: HarvestEducation[];
  certifications?: unknown[];
  skills?: unknown[];
  languages?: unknown[];
}

interface LeadSearchResult {
  elements?: Array<{
    id?: string;
    linkedinUrl?: string;
    firstName?: string;
    lastName?: string;
    currentPositions?: HarvestPosition[];
    location?: { linkedinText?: string };
  }>;
  pagination?: {
    totalElements?: number;
  };
}

interface ProfileResult {
  element?: HarvestProfile;
  status?: string;
  error?: string;
}

// ── API calls ────────────────────────────────────────────────────

/**
 * Search for a person by name and current company.
 * Returns the LinkedIn URL of the best match, or null.
 */
export async function searchPerson(
  firstName: string,
  lastName: string,
  company?: string,
): Promise<string | null> {
  const params: Record<string, string> = {
    firstNames: firstName,
    lastNames: lastName,
  };
  if (company) {
    params.search = `${firstName} ${lastName} ${company}`;
  }

  const { data } = await http.get<LeadSearchResult>(`${BASE}/linkedin/lead-search`, {
    headers: headers(),
    params,
  });

  const lead = data.elements?.[0];
  return lead?.linkedinUrl || null;
}

/**
 * Fetch a full LinkedIn profile by URL or public identifier.
 */
export async function fetchProfile(linkedinUrl: string): Promise<HarvestProfile | null> {
  const { data } = await http.get<ProfileResult>(`${BASE}/linkedin/profile`, {
    headers: headers(),
    params: { url: linkedinUrl },
  });

  if (data.error || !data.element) return null;
  return data.element;
}

/**
 * Full person enrichment: search by name/company → fetch profile.
 * Returns the full LinkedIn profile or null if not found.
 */
export async function enrichPerson(
  firstName: string,
  lastName: string,
  company?: string,
): Promise<HarvestProfile | null> {
  const linkedinUrl = await searchPerson(firstName, lastName, company);
  if (!linkedinUrl) return null;
  return fetchProfile(linkedinUrl);
}
