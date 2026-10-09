import { after } from "next/server";
import { json, sqlOne } from "@/lib/db";
import { log } from "@/lib/log";
import { processCall } from "@/lib/route/process-call";
import { PROVIDER, VaaniNotConfiguredError, parseCallWebhook, verifyWebhookSignature } from "@/lib/vaani/adapter";

export const maxDuration = 60;

/**
 * Post-call webhook. Order matters:
 * 1. verify signature  2. store raw payload  3. respond 200  4. process in after().
 * Idempotent on (provider, external_id): a retry for a call that is already received /
 * processing / processed does not reset it.
 */
export async function POST(req: Request) {
  const raw = await req.text();

  try {
    if (!verifyWebhookSignature(raw, req.headers)) return new Response("invalid signature", { status: 401 });
  } catch (err) {
    if (err instanceof VaaniNotConfiguredError) return new Response(err.message, { status: 501 });
    throw err;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  const call = parseCallWebhook(payload);
  const vaaniMinutes = call.durationSeconds != null ? Number((call.durationSeconds / 60).toFixed(3)) : null;

  // New call → insert as 'received'. Row created mid-call by a tool ('in_call') → fill it in.
  // Anything else is a retry of a call we already have: leave it alone.
  const stored = await sqlOne<{ id: string }>`
    insert into calls (provider, channel, external_id, status, raw_payload, caller_phone, started_at, ended_at, duration_seconds, vaani_minutes, transcript)
    values (${PROVIDER}, ${call.channel}, ${call.externalId}, 'received', ${json(payload)}::jsonb, ${call.callerPhone},
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

  if (!stored) {
    log.info("webhook.duplicate", { externalId: call.externalId });
    return Response.json({ ok: true, duplicate: true });
  }

  after(() => processCall(stored.id));
  return Response.json({ ok: true });
}
