# Brief Pipeline — Architecture Plan

> Google Calendar → HubSpot → Brief Pipeline (No Database)

See the detailed implementation plan at `.claude/plans/merry-dancing-snowflake.md`.

## Architecture

```
Google Calendar (rep creates/accepts meeting)
    ↓ (HubSpot native sync, 5-15 min)
HubSpot (creates Meeting engagement on Contact)
    ↓ (workflow trigger: "Meeting activity logged")
POST /api/webhooks/hubspot
    ↓
Validate signature → Fetch contact + meeting from HubSpot API → Dedup check
    ↓
8-Step Pipeline: extract → infer → questions → org name → research → rewrite → HubSpot Note → Slack DM
    ↓
Output: Note on HubSpot contact + Slack DM to rep
```

## Key Decisions

- **No database** — HubSpot is the system of record. Question templates are a static file.
- **HubSpot Notes** for brief persistence — renders as rich HTML in the contact timeline.
- **Dedup via hidden HTML marker** — `data-brief-meeting-id` embedded in each Note.
- **Slack DM** for real-time notification to the rep.
- **Private App token** for HubSpot auth (no OAuth flow needed).
