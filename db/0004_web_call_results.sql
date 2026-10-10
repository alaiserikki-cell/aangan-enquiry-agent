-- Web calls are finished by the browser: once the call ends, the app pulls the transcript from
-- Vaani's API (no dependence on webhook settings) and links the processed call here.

alter table web_calls add column vaani_call_id text;
alter table web_calls add column call_row_id uuid references calls (id) on delete set null;
