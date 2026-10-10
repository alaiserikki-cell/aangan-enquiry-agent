-- Raw inbound webhook events, stored verbatim before anything else happens.
-- Keyed on the provider's event id (VaaniVoice reuses `evt_...` across retries),
-- so a retried delivery is a no-op. Lets us inspect the real payload shape too.

create table webhook_events (
  id            text primary key,                 -- provider event id, e.g. evt_9f1c2b3a-...
  provider      text not null,                    -- 'vaani'
  type          text not null,                    -- e.g. call.completed, call.failed, webhook.ping
  delivery_id   text,                             -- X-VaaniVoice-Delivery header
  payload       jsonb not null,                   -- full envelope as received
  call_id       uuid references calls(id) on delete set null,
  received_at   timestamptz not null default now()
);

create index webhook_events_type_idx on webhook_events (type, received_at desc);
