/**
 * HubSpot API types for the brief pipeline
 */

/**
 * Webhook payload sent by HubSpot workflow "Send a webhook" action
 */
export interface HubSpotWebhookPayload {
  objectId: number;
  objectType: string;
  portalId: number;
  properties?: Record<string, string>;
  // When workflow is meeting-enrolled, this may contain the meeting ID
  associatedObjectId?: number;
  associatedObjectType?: string;
}

/**
 * HubSpot contact from CRM API
 */
export interface HubSpotContact {
  id: string;
  properties: {
    email?: string;
    firstname?: string;
    lastname?: string;
    company?: string;
    domain?: string;
    hubspot_owner_id?: string;
    [key: string]: string | undefined;
  };
}

/**
 * HubSpot meeting engagement from CRM API
 */
export interface HubSpotMeeting {
  id: string;
  properties: {
    hs_meeting_title?: string;
    hs_meeting_start_time?: string;
    hs_meeting_end_time?: string;
    hs_meeting_external_url?: string;
    hs_meeting_body?: string;
    hubspot_owner_id?: string;
    [key: string]: string | undefined;
  };
}

/**
 * HubSpot note from CRM API
 */
export interface HubSpotNote {
  id: string;
  properties: {
    hs_note_body?: string;
    hs_timestamp?: string;
    [key: string]: string | undefined;
  };
}

/**
 * HubSpot association result
 */
export interface HubSpotAssociationResult {
  results: Array<{
    id: string;
    type: string;
  }>;
}

/**
 * HubSpot API list response
 */
export interface HubSpotListResponse<T> {
  results: T[];
  paging?: {
    next?: { after: string };
  };
}
