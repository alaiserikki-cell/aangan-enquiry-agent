# Aangan Studio enquiry agent

Every phone enquiry goes to a voice agent (Vaani Labs) at any hour. The agent qualifies the caller against Nikhil's rules and books a consultation on the call (Cal.com). After the call, Gemini Flash classifies the transcript. Qualified leads become HubSpot deals, and the designer gets a brief by email (Resend) within two minutes. Nikhil follows it all on a mobile dashboard.

Next.js 16 (App Router, TypeScript) on Vercel · Neon Postgres · HubSpot free CRM · Resend · Cal.com · Gemini.

## Status

| Part | State |
|---|---|
| Database schema + seed | ✅ `db/0001_init.sql`, `db/seed.sql` (every app query checked against real Postgres) |
| Replay test | ✅ `npm run replay -- --stub` passes. Real-Gemini run needs the 12 transcripts in `tests/fixtures/transcripts/` |
| Classification (Gemini) | ✅ written, not yet run against real transcripts |
| Routing + emails | ✅ written, not yet run against live Neon/Resend |
| Cal.com tools | ✅ written against Cal.com API v2, not yet run live |
| **Vaani adapter** | ⏳ **stub**: `src/lib/vaani/adapter.ts` returns 501 until written against Vaani's API docs |
| HubSpot | ✅ written, not yet run live |
| Dashboard | ✅ |
| Crons | ✅ (see the cron note below) |

## How it works

```
Caller ─▶ Vaani agent ──(mid-call)──▶ POST /api/tools/availability ─▶ Cal.com slots for the assigned designer
                     └─(mid-call)──▶ POST /api/tools/book         ─▶ Cal.com booking (or "a designer will call within 2 hours")
         call ends ──▶ POST /api/webhooks/vaani
                          1. verify signature   2. store raw payload   3. 200 OK
                          4. after(): Gemini classify → validate → confidence gate → route
                                qualified        → designer email (+ack button) → HubSpot contact + deal
                                existing_client  → [URGENT] email to Nikhil + escalation address
                                needs_review     → email Nikhil (+ "pending review" brief to the designer if already booked)
                                declined/not_a_lead/dropped → log only (dropped with a number → call-back list)
                                agent said a price → compliance incident + email Nikhil
Crons: ack-check every 15 min (escalate after 2h, retry failed processing) · HubSpot sync hourly · digest 08:45 IST
```

Only `src/lib/vaani/` knows Vaani's payload shapes. Everything else uses `NormalizedInteraction` / `NormalizedToolCall` (`src/lib/types.ts`). The `calls` table has a `channel` column, so WhatsApp or a web form can come in later as another adapter with no schema change.

## Setup

### 1. Neon
1. Create a Neon project (AWS Mumbai, ap-south-1, is the closest region to Pune). In the **SQL Editor**, run `db/0001_init.sql`, then `db/seed.sql`. From a terminal, `psql "$DATABASE_URL" -f db/0001_init.sql` does the same.
2. Edit the three placeholder designers in **Tables → designers**: name, email, `areas` (Pune localities they prefer), and `calcom_event_type_id` (step 3).
3. Copy the **pooled** connection string into `DATABASE_URL`. The app talks to Neon over HTTPS with `@neondatabase/serverless`, which suits Vercel functions: there's no connection pool to manage.
4. Optional: Vercel's Neon integration can create the database and set `DATABASE_URL` for you.

Only the server holds `DATABASE_URL`. The browser never talks to the database.

### 2. Environment variables
Copy `.env.example` → `.env.local` for local dev, and set the same keys in Vercel. `EMAIL_TEST_MODE` defaults to **true**: every email goes to `EMAIL_TEST_RECIPIENT` with a `[TEST → real recipient]` prefix. Set it to `false` only when going live.

### 3. Cal.com
1. Give each designer a Cal.com user (or a team member seat) with their own **Consultation** event type and their working hours.
2. Put each event type's numeric ID in `designers.calcom_event_type_id`. Designers without an ID are never offered to callers during a call.
3. Create an API key (Settings → Developer → API keys) → `CALCOM_API_KEY`.
4. Callers don't give an email on the phone, so bookings carry name + phone only. To put a shared inbox on every booking, set `CALCOM_FALLBACK_ATTENDEE_EMAIL`.

### 4. HubSpot
1. Settings → Objects → Deals → Pipelines. Add a stage called **Consultation booked**, then copy its internal ID → `HUBSPOT_STAGE_CONSULTATION_BOOKED`. The pipeline ID (usually `default`) → `HUBSPOT_PIPELINE_ID`.
2. Settings → Integrations → Private apps. Create one with scopes `crm.objects.contacts.read/write` and `crm.objects.deals.read/write` → `HUBSPOT_ACCESS_TOKEN`.
3. The free CRM allows only **one** deal pipeline. For testing, use a separate free HubSpot account (or a developer test account) until you switch to the real one.

Deals never get an amount from this system. The dashboard's "won value" only sums amounts a person typed into HubSpot on won deals.

### 5. Resend
Verify your sending domain, create an API key → `RESEND_API_KEY`, and set `RESEND_FROM`.

### 6. Vaani
*Pending API docs.* Once the adapter is written:
- Inbound number → agent: _TBD from docs_.
- Paste the system prompt from `vaani-agent-prompt.md` into the agent.
- Tools:
  - `check_availability` → `POST <APP_URL>/api/tools/availability`. Args: `location` (string), `consultation_mode` (`home` | `studio`).
  - `book_consultation` → `POST <APP_URL>/api/tools/book`. Args: `slot` (ISO start time returned by check_availability), `caller_name`, `phone`, `location`, `consultation_mode`.
  - Both need the Vaani call ID to reach us so the booking links to the call.
- Post-call webhook → `POST <APP_URL>/api/webhooks/vaani` with `VAANI_WEBHOOK_SECRET`.

### 7. Vercel + crons
1. Import the GitHub repo into Vercel and set the env vars. Set `APP_URL` to the production URL.
2. `vercel.json` schedules the **daily digest** at `15 3 * * *` (03:15 UTC = 08:45 IST).
3. **Vercel Hobby only allows daily crons.** The 15-minute ack check and the hourly HubSpot sync run from GitHub Actions instead (`.github/workflows/crons.yml`). Add the repo secrets `APP_URL` and `CRON_SECRET`. GitHub can start scheduled runs a few minutes late, which is fine for these jobs. On Vercel Pro you can move both into `vercel.json` and delete the workflow.
4. Every cron endpoint requires `Authorization: Bearer $CRON_SECRET`.

## Testing

```bash
npm run replay -- --stub      # no network: gate, routing plan, email rendering, price guard
npm run replay                # real Gemini over tests/fixtures/transcripts/T*.txt (needs GEMINI_API_KEY)
npm run replay -- T07 T10     # selected cases
```

Hard failures: outcome, decline_reason, pricing_requested, price_mentioned_by_agent (must be false), routing (T09 must never create a deal or handoff), and any price figure in a rendered email or deal. Flags are free text, so they are printed side by side but never fail the run.

## Safety rules, and where they are enforced

- **No prices anywhere** (`src/lib/price-guard.ts`). Caller-derived text is redacted before rendering. Every email and deal description is scanned again before sending, and a hit blocks the send and logs an incident. A volunteered budget shows as "Mentioned by caller (amount withheld)". The dashboard transcript view hides amounts too.
- **The agent quoting a price** → `incidents` row + immediate email to Nikhil.
- **Phone numbers**: shown only on the authenticated dashboard and in designer and digest emails. `src/lib/log.ts` strips them from logs.
- **Idempotency**: webhook keyed on `(provider, external_id)`. Processing claims the row atomically, reuses an existing classification, and every side effect has its own dedupe record (`handoffs`, `hubspot_sync`, `incidents`, `emails.dedupe_key`).

## Deliberate choices to review

- **"I've got this" button**: the link opens a one-tap confirm page, and the tap (a POST) records the acknowledgement. A plain GET would be auto-clicked by Outlook and Gmail link scanners and mark every lead acknowledged.
- **Booked call that comes back `needs_review`**: the designer still gets the brief, marked "pending review", so the slot isn't missed. Nikhil gets the review email. No HubSpot deal is created until Nikhil decides.
- **Booking failure**: the handoff goes to the designer with Nikhil copied, because the caller was promised a callback within two hours.
- **Round-robin**: least-recently-assigned active designer, preferring ones whose `areas` match the caller's location. The pointer moves only when a booking is made, or when a handoff is assigned post-call.
