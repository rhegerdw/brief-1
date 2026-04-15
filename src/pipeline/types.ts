/**
 * Calendar event source type
 */
export type CalendarSource = 'hubspot' | 'manual';

/**
 * HubSpot-sourced event data (normalized from HubSpot contact + meeting)
 */
export interface HubSpotEventData {
  contactId: string;
  meetingId: string;
  attendeeEmail: string;
  attendeeName?: string;
  companyName?: string;
  companyDomain?: string;
  meetingTitle?: string;
  meetingStartTime?: string;
  meetingEndTime?: string;
  conferenceLink?: string;
  ownerEmail?: string;
}

/**
 * Normalized event details (source-agnostic)
 */
export interface EventDetails {
  uuid?: string;
  start_time?: string;
  end_time?: string;
  name?: string;
  status?: string;
  join_url?: string | null;
}

/**
 * Brief generation result
 */
export interface BriefResult {
  brief_html?: string;
  citations?: Array<{ url?: string; title?: string }>;
  metrics?: Record<string, unknown>;
  sources?: Array<{ url?: string; title?: string }>;
}

/**
 * Pipeline logger interface
 */
export interface PipelineLogger {
  info: (msg: string) => void;
  warn: (msg: string, extra?: unknown) => void;
  error: (context: string, error: unknown, extra?: unknown) => void;
}

/**
 * Pipeline context passed between steps
 */
export interface PipelineContext {
  // Source
  source: CalendarSource;
  requestId?: string;

  // HubSpot data
  hubspotEvent?: HubSpotEventData;
  hubspotContactId?: string;
  hubspotMeetingId?: string;
  hubspotNoteId?: string;

  // Normalized event details
  eventDetails?: EventDetails;

  // Attendee/company info
  attendeeEmail?: string;
  attendeeName?: string;
  companyName?: string;

  // Inferred data
  inferred?: {
    domain?: string;
    industry_key?: string;
    confidence?: number;
    method?: string;
  };
  industryKey?: string;

  // Territory info
  territory?: string;
  territoryState?: string;
  territorySource?: 'company_name' | 'email_subdomain' | 'email_domain_city' | 'inferred';
  territoryConfidence?: 'high' | 'medium' | 'low';

  // Question templates
  questionsRaw?: string[];
  rewrittenQuestions?: string[];

  // Org/attendee display info
  orgName?: string;
  displayName?: string;

  // Brief result
  briefResult?: BriefResult;

  // Logging
  log: PipelineLogger;
}
