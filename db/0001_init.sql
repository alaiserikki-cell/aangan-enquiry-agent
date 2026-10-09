-- Aangan Studio enquiry agent: initial schema.
-- Neon Postgres. Run once on an empty database: paste into the Neon SQL Editor, or
--   psql "$DATABASE_URL" -f db/0001_init.sql
-- gen_random_uuid() is built into Postgres 13+, so no extension is needed.

-- ---------------------------------------------------------------------------
-- designers
-- ---------------------------------------------------------------------------
create table designers (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  email                 text not null unique,
  -- Areas this designer prefers to cover, e.g. {'Kothrud','Baner','Aundh'}.
  -- Matched case-insensitively as a substring of the caller's stated location.
  areas                 text[] not null default '{}',
  active                boolean not null default true,
  -- The Cal.com event type that books THIS designer's calendar.
  calcom_event_type_id  integer,
  last_assigned_at      timestamptz,
  created_at            timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- calls: one row per enquiry interaction. `channel` exists so WhatsApp / web
-- form can be added later without a new table; only 'phone' is used today.
-- ---------------------------------------------------------------------------
create table calls (
  id                     uuid primary key default gen_random_uuid(),
  channel                text not null default 'phone'
                           check (channel in ('phone', 'whatsapp', 'web_form')),
  provider               text not null default 'vaani',
  external_id            text not null,              -- provider's call ID (idempotency key)
  status                 text not null default 'in_call'
                           check (status in ('in_call', 'received', 'processing', 'processed', 'failed')),
  processing_attempts    integer not null default 0,
  processing_error       text,

  raw_payload            jsonb,                      -- stored verbatim before any processing
  caller_phone           text,                       -- personal data: dashboard + designer email only
  started_at             timestamptz,
  ended_at               timestamptz,
  duration_seconds       integer,
  transcript             jsonb,                      -- normalised [{role, text}]

  outcome                text check (outcome in
                           ('qualified', 'declined', 'needs_review', 'existing_client', 'not_a_lead', 'dropped')),
  decline_reason         text check (decline_reason in
                           ('out_of_area', 'advice_only', 'timeline', 'budget_mismatch', 'out_of_scope_type')),
  review_reason          text,                       -- why it is needs_review (invalid JSON, low confidence, ...)
  classification         jsonb,                      -- full validated classifier output (or raw on failure)
  classified_at          timestamptz,

  -- Booking made live during the call by /api/tools/book
  designer_id            uuid references designers(id),
  booking_status         text not null default 'none'
                           check (booking_status in ('none', 'booked', 'booking_failed')),
  booking_uid            text,
  booking_start          timestamptz,
  consultation_mode      text check (consultation_mode in ('home', 'studio')),

  -- Usage for cost reporting. Rates live in env vars, never here.
  vaani_minutes          numeric(10, 3),
  gemini_input_tokens    integer not null default 0,
  gemini_output_tokens   integer not null default 0,

  callback_done_at       timestamptz,                -- dropped-call follow-up ticked off on the dashboard
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (provider, external_id)
);

create index calls_created_at_idx on calls (created_at desc);
create index calls_outcome_idx on calls (outcome);
create index calls_status_idx on calls (status);

-- ---------------------------------------------------------------------------
-- handoffs: designer brief email + acknowledgement
-- ---------------------------------------------------------------------------
create table handoffs (
  id                  uuid primary key default gen_random_uuid(),
  call_id             uuid not null unique references calls(id) on delete cascade,
  designer_id         uuid not null references designers(id),
  email_sent_at       timestamptz,
  ack_token           text not null unique,          -- SHA-256 hash of the token in the email link
  ack_expires_at      timestamptz not null,
  acknowledged_at     timestamptz,
  escalated_at        timestamptz,
  created_at          timestamptz not null default now()
);

create index handoffs_pending_idx on handoffs (email_sent_at) where acknowledged_at is null;

-- ---------------------------------------------------------------------------
-- hubspot_sync
-- ---------------------------------------------------------------------------
create table hubspot_sync (
  id                  uuid primary key default gen_random_uuid(),
  call_id             uuid not null unique references calls(id) on delete cascade,
  contact_id          text,
  deal_id             text,
  deal_stage          text,
  is_closed_won       boolean not null default false,
  is_closed           boolean not null default false,
  won_amount          numeric(14, 2),                -- only ever copied from a human-entered HubSpot amount
  synced_at           timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- incidents: compliance and operational problems
-- ---------------------------------------------------------------------------
create table incidents (
  id                  uuid primary key default gen_random_uuid(),
  call_id             uuid references calls(id) on delete cascade,
  type                text not null,                 -- price_mentioned_by_agent | price_guard_blocked | processing_failed
  details             jsonb not null default '{}',
  notified_at         timestamptz,
  created_at          timestamptz not null default now(),
  unique (call_id, type)
);

-- ---------------------------------------------------------------------------
-- emails: every email we send (dedupe on retry + Resend cost reporting)
-- ---------------------------------------------------------------------------
create table emails (
  id                  uuid primary key default gen_random_uuid(),
  call_id             uuid references calls(id) on delete cascade,
  kind                text not null,                 -- handoff | urgent_existing_client | needs_review | compliance | unacknowledged | digest
  dedupe_key          text not null unique,          -- e.g. '<call_id>:handoff' or 'digest:2026-10-09'
  recipients          text[] not null,
  subject             text not null,
  resend_id           text,
  test_mode           boolean not null default false,
  sent_at             timestamptz,
  error               text,
  created_at          timestamptz not null default now()
);

create index emails_created_at_idx on emails (created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at trigger for calls
-- ---------------------------------------------------------------------------
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger calls_updated_at before update on calls
  for each row execute function set_updated_at();
