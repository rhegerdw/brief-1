# Brief

> Pre-meeting brief generation pipeline for sales teams

Generate research briefs before meetings by automatically pulling company information, LinkedIn data, and relevant news when calendar events are created.

## Features

- **Multi-source calendar support** - Calendly webhooks, Google Calendar API, or Google Apps Script
- **Automated research** - Serper (Google search), Firecrawl (web scraping), Harvest (LinkedIn)
- **LLM-powered briefs** - GPT-5-mini generates 3-5 bullet executive summaries
- **Slack notifications** - Instant delivery to channels and DMs
- **Industry-specific questions** - Pre-loaded discovery questions by vertical

## Architecture

```
Calendar Event → Webhook → 15-Step Pipeline → Brief + Slack Notification
```

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

# Run migrations
pnpm db:migrate

# Dev
pnpm dev
```

## Documentation

| Document | Description |
|----------|-------------|
| [PORTING_PLAN.md](./PORTING_PLAN.md) | Complete porting plan from OutSearched |
| [docs/GOOGLE_CALENDAR_INTEGRATION.md](./docs/GOOGLE_CALENDAR_INTEGRATION.md) | Google Calendar setup guide |

## Calendar Integration Options

### Option 1: Calendly (Recommended for booking pages)

1. Create webhook in Calendly dashboard
2. Point to `POST /api/webhooks/calendly`
3. Set `CALENDLY_SIGNING_SECRET`

### Option 2: Google Calendar API

1. Create Google Cloud project
2. Enable Calendar API
3. Configure OAuth
4. Register watch channels

See [Google Calendar Integration Guide](./docs/GOOGLE_CALENDAR_INTEGRATION.md)

### Option 3: Google Apps Script

1. Deploy Apps Script to Workspace
2. Create calendar trigger
3. Configure webhook secret

See [Apps Script section](./docs/GOOGLE_CALENDAR_INTEGRATION.md#approach-2-google-apps-script)

## Environment Variables

```bash
# Required
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=
SERPER_API_KEY=
SLACK_BOT_TOKEN=

# Calendly (if using)
CALENDLY_SIGNING_SECRET=

# Google Calendar (if using)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Optional
FIRECRAWL_KEY=
HARVEST_API_KEY=
```

## Pipeline Steps

| # | Step | Description |
|---|------|-------------|
| 1 | fetchEventDetails | Fetch event from calendar API |
| 2 | parseFormInputs | Extract company/website from intake form |
| 3 | inferDomainIndustry | LLM classification of industry |
| 4 | upsertCompanyMeeting | Create database records |
| 5 | recordArtifacts | Store debug metadata |
| 6 | fetchQuestionTemplates | Load industry-specific questions |
| 7 | buildOrgName | Clean organization name |
| 8 | generateMeetingBrief | Run research pipeline |
| 9 | harvestEnrichment | LinkedIn data enrichment |
| 10 | rewriteQuestions | Improve question wording |
| 11 | scoreMandates | Match against buyer criteria (optional) |
| 12 | prefetchSmartlead | Cache email context (optional) |
| 13 | persistBrief | Save to database |
| 14 | createBriefUrl | Generate view URL |
| 15 | sendSlackNotifications | Post to Slack |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/webhooks/calendly` | POST | Calendly webhook receiver |
| `/api/webhooks/google-calendar` | POST | Google Calendar push notification |
| `/api/webhooks/apps-script` | POST | Apps Script webhook receiver |
| `/api/view/brief` | GET | HTML brief viewer |
| `/api/internal/refresh-watch` | POST | Renew Google Calendar channels |

## Database Schema

```sql
companies (id, name, domain, territory, state)
meetings (id, company_id, attendee_email, starts_at, source)
meetingbrief_results (meeting_id, brief_html, citations, metrics)
```

## License

Private - All Rights Reserved
