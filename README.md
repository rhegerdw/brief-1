# Brief

> Pre-meeting brief generation pipeline for sales teams

Generate research briefs before meetings by automatically pulling company information, LinkedIn data, and relevant news when calendar events sync to HubSpot.

## How It Works

```
Google Calendar → HubSpot (native sync) → Workflow Webhook → Pipeline → Brief (HubSpot Note) + Slack DM
```

1. A sales rep creates or accepts a meeting on Google Calendar
2. HubSpot's native Google Calendar integration syncs the meeting to the contact record
3. A HubSpot workflow fires and sends a webhook to this app
4. The pipeline researches the attendee's company and generates a brief
5. The brief is saved as a **Note on the HubSpot contact** (permanent CRM record)
6. A **Slack DM** notifies the rep that the brief is ready

## Features

- **HubSpot-native** — briefs live on contact records in your CRM
- **Automated research** — Serper (Google search), Firecrawl (web scraping), Harvest (LinkedIn)
- **LLM-powered briefs** — AI-generated executive summaries
- **Slack notifications** — instant DM when a brief is ready
- **Industry-specific questions** — pre-loaded discovery questions by vertical

## Quick Start

```bash
# Clone
git clone https://github.com/your-org/brief.git
cd brief

# Install
pnpm install

# Configure
cp .env.example .env.local
# Edit .env.local with your API keys

# Dev
pnpm dev
```

## HubSpot Setup

### 1. Private App

Create a Private App in HubSpot (Settings → Integrations → Private Apps) with scopes:
- `crm.objects.contacts.read`
- `crm.objects.notes.write`
- `crm.objects.notes.read`
- `crm.objects.meetings.read`

### 2. Google Calendar Sync

Connect rep Google Calendar accounts in HubSpot (Settings → Integrations → Google Calendar).

### 3. Workflow

Create a workflow in HubSpot (Automation → Workflows):
- **Enrollment trigger:** Meeting activity logged
- **Action:** Send a webhook → `POST https://<your-domain>/api/webhooks/hubspot`

## Environment Variables

```bash
# Required
HUBSPOT_ACCESS_TOKEN=       # Private App token
OPENAI_API_KEY=             # For LLM brief generation

# HubSpot (optional)
HUBSPOT_CLIENT_SECRET=      # For webhook signature validation
HUBSPOT_PORTAL_ID=          # Portal ID

# Slack (optional)
SLACK_BOT_TOKEN=
SLACK_CEO_USER_ID=          # User ID to receive brief DMs

# Research APIs (optional)
SERPER_API_KEY=
FIRECRAWL_KEY=
HARVEST_API_KEY=

# AI (optional)
ANTHROPIC_API_KEY=
GOOGLE_API_KEY=             # For Gemini
```

## Pipeline Steps

| # | Step | Description |
|---|------|-------------|
| 1 | extractEventDetails | Normalize HubSpot contact + meeting data |
| 2 | inferDomainIndustry | Extract domain from email, classify industry |
| 3 | fetchQuestionTemplates | Load industry-specific discovery questions |
| 4 | buildOrgName | Clean organization name for display |
| 5 | generateMeetingBrief | Run research pipeline (Serper → Firecrawl → LLM) |
| 6 | rewriteQuestions | LLM-refine question wording |
| 7 | persistToHubSpot | Create Note on HubSpot contact with brief |
| 8 | sendSlackNotification | DM the rep via Slack |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/webhooks/hubspot` | POST | HubSpot workflow webhook receiver |
| `/api/health` | GET | Health check |

## License

Private - All Rights Reserved
