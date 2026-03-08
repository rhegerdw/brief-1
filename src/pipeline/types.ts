import type { CalendlyQA } from '../integrations/calendly/parser.js';

/**
 * Calendar event source type
 */
export type CalendarSource = 'calendly' | 'google' | 'manual';

/**
 * Calendly webhook payload types
 */
export interface CalendlyInvitee {
  name?: string;
  email?: string;
}

export interface CalendlyEvent {
  uuid?: string;
  start_time?: string;
  end_time?: string;
  name?: string;
  status?: string;
  join_url?: string | null;
}

export interface CalendlyWebhookInnerPayload {
  event?: CalendlyEvent;
  invitee?: CalendlyInvitee;
  questions_and_answers?: CalendlyQA[];
}

export interface CalendlyWebhookPayload {
  payload?: CalendlyWebhookInnerPayload;
}

/**
 * Google Calendar event (from sync or Apps Script)
 */
export interface GoogleCalendarEvent {
  eventId: string;
  summary?: string;
  start: string;
  end?: string;
  attendee: {
    email: string;
    name?: string;
  };
  hangoutLink?: string;
  conferenceLink?: string;
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
 * Meeting payload for database upsert
 */
export interface MeetingPayload {
  external_event_id?: string;
  attendee_email?: string;
  attendee_name?: string;
  start_time?: string;
  join_url?: string | null;
  questions_and_answers?: CalendlyQA[];
  industry_key?: string;
  company_name?: string;
  website?: string;
  domain?: string;
  territory?: string;
  state?: string;
  source?: CalendarSource;
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

  // Raw payloads (one will be set based on source)
  calendlyPayload?: CalendlyWebhookPayload;
  googleEvent?: GoogleCalendarEvent;

  // Normalized event details
  eventDetails?: EventDetails;
  eventUuid?: string;

  // Form/intake data
  qas?: CalendlyQA[];
  attendeeEmail?: string;
  attendeeName?: string;
  companyNameFromForm?: string;
  websiteFromForm?: string;
  normalizedFormDomain?: string | null;
  websiteLooksValid?: boolean;

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

  // Database IDs
  companyId?: string;
  meetingId?: string;

  // Company/meeting data
  companyRow?: { name?: string; location?: string };
  meetingPayload?: MeetingPayload;

  // Question templates
  questionsRaw?: string[];
  rewrittenQuestions?: string[];

  // Org/attendee info
  orgName?: string;
  displayName?: string;
  knownRole?: string | null;
  pinnedUrl?: string | null;

  // Brief result
  briefResult?: BriefResult;

  // Enrichment
  hqLocation?: string;

  // Output URLs
  linkUrl?: string;

  // Logging
  log: PipelineLogger;
}
