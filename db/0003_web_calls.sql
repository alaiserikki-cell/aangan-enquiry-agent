-- Public "talk to the assistant" web calls: one row per session we start, so we can cap
-- usage (per visitor, per day, lifetime) and protect the Vaani credit.

create table web_calls (
  id            uuid primary key default gen_random_uuid(),
  room_name     text unique,                     -- Vaani/LiveKit room; matches the webhook call id
  visitor_hash  text not null,                   -- SHA-256 of IP + secret; no raw IPs stored
  created_at    timestamptz not null default now()
);

create index web_calls_created_idx on web_calls (created_at desc);
create index web_calls_visitor_idx on web_calls (visitor_hash, created_at desc);
