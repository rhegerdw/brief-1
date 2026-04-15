/**
 * HubSpot CRM API client
 * Uses Private App bearer token for authentication
 */

import axios from 'axios';
import type {
  HubSpotContact,
  HubSpotMeeting,
  HubSpotNote,
  HubSpotAssociationResult,
  HubSpotListResponse,
} from './types.js';

const BASE = 'https://api.hubapi.com';

function headers() {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) throw new Error('HUBSPOT_ACCESS_TOKEN is not set');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Fetch a contact by HubSpot contact ID
 */
export async function fetchContact(contactId: string): Promise<HubSpotContact> {
  const { data } = await axios.get<HubSpotContact>(
    `${BASE}/crm/v3/objects/contacts/${contactId}`,
    {
      headers: headers(),
      params: {
        properties: 'email,firstname,lastname,company,domain,hubspot_owner_id',
      },
    },
  );
  return data;
}

/**
 * Fetch the most recent meeting associated with a contact
 */
export async function fetchRecentMeetingForContact(contactId: string): Promise<HubSpotMeeting | null> {
  // Get meeting associations for this contact
  const { data: assoc } = await axios.get<HubSpotAssociationResult>(
    `${BASE}/crm/v3/objects/contacts/${contactId}/associations/meetings`,
    { headers: headers() },
  );

  if (!assoc.results?.length) return null;

  // Fetch the meetings and return the most recent one
  const meetingIds = assoc.results.map((r) => r.id);

  const { data: meetings } = await axios.post<HubSpotListResponse<HubSpotMeeting>>(
    `${BASE}/crm/v3/objects/meetings/batch/read`,
    {
      inputs: meetingIds.map((id) => ({ id })),
      properties: [
        'hs_meeting_title',
        'hs_meeting_start_time',
        'hs_meeting_end_time',
        'hs_meeting_external_url',
        'hubspot_owner_id',
      ],
    },
    { headers: headers() },
  );

  if (!meetings.results?.length) return null;

  // Sort by start time descending, return most recent
  const sorted = meetings.results.sort((a, b) => {
    const aTime = a.properties.hs_meeting_start_time || '';
    const bTime = b.properties.hs_meeting_start_time || '';
    return bTime.localeCompare(aTime);
  });

  return sorted[0];
}

/**
 * Fetch a specific meeting by ID
 */
export async function fetchMeeting(meetingId: string): Promise<HubSpotMeeting> {
  const { data } = await axios.get<HubSpotMeeting>(
    `${BASE}/crm/v3/objects/meetings/${meetingId}`,
    {
      headers: headers(),
      params: {
        properties: 'hs_meeting_title,hs_meeting_start_time,hs_meeting_end_time,hs_meeting_external_url,hubspot_owner_id',
      },
    },
  );
  return data;
}

/**
 * Create a Note on a HubSpot contact
 * Association type 202 = note-to-contact
 */
export async function createNote(contactId: string, htmlBody: string): Promise<string> {
  const { data } = await axios.post<HubSpotNote>(
    `${BASE}/crm/v3/objects/notes`,
    {
      properties: {
        hs_timestamp: new Date().toISOString(),
        hs_note_body: htmlBody,
      },
      associations: [
        {
          to: { id: contactId },
          types: [
            {
              associationCategory: 'HUBSPOT_DEFINED',
              associationTypeId: 202,
            },
          ],
        },
      ],
    },
    { headers: headers() },
  );
  return data.id;
}

/**
 * Check if a brief Note already exists for a given meeting on this contact.
 * We embed a hidden marker `data-brief-meeting-id` in the note HTML for dedup.
 */
export async function findExistingBriefNote(contactId: string, meetingId: string): Promise<boolean> {
  // Get note associations for this contact
  const { data: assoc } = await axios.get<HubSpotAssociationResult>(
    `${BASE}/crm/v3/objects/contacts/${contactId}/associations/notes`,
    { headers: headers() },
  );

  if (!assoc.results?.length) return false;

  // Check each note for our dedup marker
  const noteIds = assoc.results.map((r) => r.id);
  const { data: notes } = await axios.post<HubSpotListResponse<HubSpotNote>>(
    `${BASE}/crm/v3/objects/notes/batch/read`,
    {
      inputs: noteIds.map((id) => ({ id })),
      properties: ['hs_note_body'],
    },
    { headers: headers() },
  );

  const marker = `data-brief-meeting-id="${meetingId}"`;
  return notes.results.some((n) => n.properties.hs_note_body?.includes(marker));
}
