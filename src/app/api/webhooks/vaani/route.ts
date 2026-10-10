import { after } from "next/server";
import { json, sql, sqlOne } from "@/lib/db";
import { log } from "@/lib/log";
import { processCall } from "@/lib/route/process-call";
import {
  CALL_EVENTS,
  PROVIDER,
  VaaniNotConfiguredError,
  parseCallWebhook,
  parseWebhookEnvelope,
  verifyWebhookSignature,
} from "@/lib/vaani/adapter";

export const maxDuration = 60;

/**
 * VaaniVoice webhook. Order matters:
 * 1. verify signature  2. store the raw envelope (idempotent on the evt_ id)  3. 2xx
 * 4. for call events, normalise and process in after().
 * VaaniVoice retries up to 8 times and auto-disables the webhook after 5 consecutive failures,
 * so anything we can't process yet is still stored and acknowledged, never bounced.
 */
export async function POST(req: Request) {
  const raw = await req.text();

  try {
    if (!verifyWebhookSignature(raw, req.headers)) return new Response("invalid signature", { status: 401 });
  } catch (err) {
    if (err instanceof VaaniNotConfiguredError) return new Response(err.message, { status: 503 });
    throw err;
  }

  let envelope;
  try {
    envelope = parseWebhookEnvelope(JSON.parse(raw));
  } catch {
    return new Response("invalid envelope", { status: 400 });
  }

  const stored = await sqlOne<{ id: string }>`
    insert into webhook_events (id, provider, type, delivery_id, payload)
    values (${envelope.eventId}, ${PROVIDER}, ${envelope.type}, ${req.headers.get("x-vaanivoice-delivery")}, ${raw}::jsonb)
    on conflict (id) do nothing
    returning id`;
  if (!stored) return Response.json({ ok: true, duplicate: true });

  if (!CALL_EVENTS.has(envelope.type)) return Response.json({ ok: true, ignored: envelope.type });

  let call;
  try {
    call = parseCallWebhook(envelope);
  } catch (err) {
    if (err instanceof VaaniNotConfiguredError) {
      log.warn("webhook.stored_unmapped", { eventId: envelope.eventId, type: envelope.type });
      return Response.json({ ok: true, stored: true, processed: false });
    }
    throw err;
  }

  const vaaniMinutes = call.durationSeconds != null ? Number((call.durationSeconds / 60).toFixed(3)) : null;

  // New call → insert as 'received'. Row created mid-call by a tool ('in_call') → fill it in.
  // Anything else is a retry of a call we already have: leave it alone.
  const row = await sqlOne<{ id: string }>`
    insert into calls (provider, channel, external_id, status, raw_payload, caller_phone, started_at, ended_at, duration_seconds, vaani_minutes, transcript)
    values (${PROVIDER}, ${call.channel}, ${call.externalId}, 'received', ${raw}::jsonb, ${call.callerPhone},
            ${call.startedAt}, ${call.endedAt}, ${call.durationSeconds}, ${vaaniMinutes}, ${json(call.transcript)}::jsonb)
    on conflict (provider, external_id) do update set
      status = 'received',
      raw_payload = excluded.raw_payload,
      caller_phone = coalesce(excluded.caller_phone, calls.caller_phone),
      started_at = excluded.started_at,
      ended_at = excluded.ended_at,
      duration_seconds = excluded.duration_seconds,
      vaani_minutes = excluded.vaani_minutes,
      transcript = excluded.transcript
    where calls.status = 'in_call'
    returning id`;

  if (!row) {
    log.info("webhook.duplicate_call", { externalId: call.externalId });
    return Response.json({ ok: true, duplicate: true });
  }

  await sql`update webhook_events set call_id = ${row.id} where id = ${envelope.eventId}`;
  after(() => processCall(row.id));
  return Response.json({ ok: true });
}
