import { after } from "next/server";
import { json, sql, sqlOne } from "@/lib/db";
import { log } from "@/lib/log";
import { processCall } from "@/lib/route/process-call";
import { pendingCallKey } from "@/lib/tools";
import {
  PROVIDER,
  VaaniNotConfiguredError,
  callEndedInfo,
  callStartedInfo,
  parseCallWebhook,
  parseWebhookEvent,
  verifyWebhookSignature,
} from "@/lib/vaani/adapter";

export const maxDuration = 60;

/** Events that change data. Only these are ever rejected loudly; anything else unsigned is a harmless ping. */
const REAL_EVENTS = new Set(["call_started", "call_ended", "call_postprocessing"]);

function safeEventName(raw: string): string | null {
  try {
    const e = (JSON.parse(raw) as { event?: unknown }).event;
    return typeof e === "string" ? e.slice(0, 40) : null;
  } catch {
    return null;
  }
}

/**
 * Vaani agent webhook. Every event: verify signature → store raw (idempotent on event+call) → 2xx.
 *   call_started         → open/attach the call row and record the caller's number
 *   call_ended           → record duration
 *   call_postprocessing  → transcript in; classify + route in after()
 * Anything else is stored and acknowledged. Vaani expects a reply within 5 seconds.
 */
export async function POST(req: Request) {
  const raw = await req.text();

  try {
    if (!verifyWebhookSignature(raw, req.headers)) {
      // Diagnostics only: header names and the event name, never values or the body.
      const eventName = safeEventName(raw);
      log.warn("vaani.webhook.bad_signature", {
        event: eventName,
        headers: [...req.headers.keys()].filter((k) => !/^(cookie|authorization)$/i.test(k)).join(","),
        hasSignature: req.headers.has("x-vaani-signature"),
        hasTimestamp: req.headers.has("x-vaani-timestamp"),
      });
      // Vaani's "Test" button may send an unsigned ping. Acknowledge it without storing or acting on it.
      if (!eventName || !REAL_EVENTS.has(eventName)) return Response.json({ ok: true, ignored: "unsigned test" });
      return new Response("invalid signature", { status: 401 });
    }
  } catch (err) {
    if (err instanceof VaaniNotConfiguredError) return new Response(err.message, { status: 503 });
    throw err;
  }

  let event;
  try {
    event = parseWebhookEvent(JSON.parse(raw));
  } catch {
    return new Response("invalid payload", { status: 400 });
  }

  const stored = await sqlOne<{ id: string }>`
    insert into webhook_events (id, provider, type, payload)
    values (${event.key}, ${PROVIDER}, ${event.event}, ${raw}::jsonb)
    on conflict (id) do nothing
    returning id`;
  if (!stored) return Response.json({ ok: true, duplicate: true });

  switch (event.event) {
    case "call_started": {
      const info = callStartedInfo(event);
      if (!info) break;
      // A booking made mid-call before we knew the call id was filed under the caller's phone; re-key it.
      if (info.callerPhone) {
        await sql`
          update calls set external_id = ${info.callId}
          where provider = ${PROVIDER} and external_id = ${pendingCallKey(info.callerPhone)} and status = 'in_call'
            and created_at > now() - interval '2 hours'
            and not exists (select 1 from calls c2 where c2.provider = ${PROVIDER} and c2.external_id = ${info.callId})`;
      }
      await sql`
        insert into calls (provider, channel, external_id, status, caller_phone, started_at)
        values (${PROVIDER}, 'phone', ${info.callId}, 'in_call', ${info.callerPhone}, now())
        on conflict (provider, external_id) do update set
          caller_phone = coalesce(calls.caller_phone, excluded.caller_phone),
          started_at = coalesce(calls.started_at, excluded.started_at)`;
      break;
    }

    case "call_ended": {
      const info = callEndedInfo(event);
      if (!info || info.durationSeconds == null) break;
      await sql`
        update calls set duration_seconds = ${Math.round(info.durationSeconds)},
          vaani_minutes = ${Number((info.durationSeconds / 60).toFixed(3))},
          ended_at = coalesce(ended_at, now())
        where provider = ${PROVIDER} and external_id = ${info.callId}`;
      break;
    }

    case "call_postprocessing": {
      const call = parseCallWebhook(event);
      const vaaniMinutes = call.durationSeconds != null ? Number((call.durationSeconds / 60).toFixed(3)) : null;
      // New call → 'received'. Row opened by call_started or a tool ('in_call') → fill in and release.
      // Already received/processing/processed → a retry; leave it alone.
      const row = await sqlOne<{ id: string }>`
        insert into calls (provider, channel, external_id, status, raw_payload, caller_phone, started_at, ended_at, duration_seconds, vaani_minutes, transcript)
        values (${PROVIDER}, ${call.channel}, ${call.externalId}, 'received', ${raw}::jsonb, ${call.callerPhone},
                ${call.startedAt}, ${call.endedAt}, ${call.durationSeconds}, ${vaaniMinutes}, ${json(call.transcript)}::jsonb)
        on conflict (provider, external_id) do update set
          status = 'received',
          raw_payload = excluded.raw_payload,
          caller_phone = coalesce(calls.caller_phone, excluded.caller_phone),
          started_at = coalesce(calls.started_at, excluded.started_at),
          ended_at = coalesce(excluded.ended_at, calls.ended_at),
          duration_seconds = coalesce(excluded.duration_seconds, calls.duration_seconds),
          vaani_minutes = coalesce(excluded.vaani_minutes, calls.vaani_minutes),
          transcript = excluded.transcript
        where calls.status = 'in_call'
        returning id`;
      if (!row) {
        log.info("webhook.duplicate_call", { callId: call.externalId });
        break;
      }
      await sql`update webhook_events set call_id = ${row.id} where id = ${event.key}`;
      after(() => processCall(row.id));
      break;
    }
  }

  return Response.json({ ok: true });
}
