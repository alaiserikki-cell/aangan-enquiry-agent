import { after } from "next/server";
import { json, sql, sqlOne } from "@/lib/db";
import { log } from "@/lib/log";
import { processCall } from "@/lib/route/process-call";
import type { TranscriptTurn } from "@/lib/types";
import { PROVIDER, VaaniNotConfiguredError, fetchCallTranscript } from "@/lib/vaani/adapter";

export const maxDuration = 60; // after(): classification + routing can take ~30 s with Gemini retries

/** Captions captured in the browser, cleaned and bounded. Used only when Vaani's copy lacks the caller. */
function browserTurns(raw: unknown): TranscriptTurn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 150)
    .flatMap((t): TranscriptTurn[] => {
      const o = (t && typeof t === "object" ? t : {}) as { role?: unknown; text?: unknown };
      const text = typeof o.text === "string" ? o.text.replace(/\s+/g, " ").trim().slice(0, 1500) : "";
      return text && (o.role === "agent" || o.role === "caller") ? [{ role: o.role, text }] : [];
    });
}

/**
 * The browser calls this after a web call ends (and polls until it reports done). We pull the
 * transcript from Vaani ourselves, so a test call reaches classification, email and the dashboard
 * even if the Vaani webhook isn't configured. If the webhook also delivers, the call row is shared
 * (same external id) and processing happens once.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { roomName?: unknown; seconds?: unknown; turns?: unknown } | null;
  const roomName = typeof body?.roomName === "string" ? body.roomName.slice(0, 200) : "";
  if (!roomName) return Response.json({ ok: false, reason: "missing room" }, { status: 400 });

  // Only rooms this app started, in the last hour.
  const wc = await sqlOne<{ id: string; vaani_call_id: string | null; call_row_id: string | null; max_s: number }>`
    select id, vaani_call_id, call_row_id, extract(epoch from (now() - created_at))::int as max_s
    from web_calls where room_name = ${roomName} and created_at > now() - interval '1 hour'`;
  if (!wc) return Response.json({ ok: false, reason: "unknown call" }, { status: 404 });
  if (wc.call_row_id) return Response.json({ ok: true, callId: wc.call_row_id });

  const externalId = wc.vaani_call_id ?? roomName;

  // The webhook may already have recorded this call.
  const existing = await sqlOne<{ id: string; status: string }>`
    select id, status from calls where provider = ${PROVIDER} and external_id = ${externalId}`;
  if (existing && existing.status !== "in_call") {
    await sql`update web_calls set call_row_id = ${existing.id} where id = ${wc.id}`;
    return Response.json({ ok: true, callId: existing.id });
  }

  let transcript: TranscriptTurn[] = [];
  try {
    transcript = await fetchCallTranscript([...new Set([externalId, roomName])]);
  } catch (err) {
    if (err instanceof VaaniNotConfiguredError) return Response.json({ ok: false, reason: "Web calling isn't set up." }, { status: 503 });
    log.warn("webcall.transcript_fetch_failed", { error: String(err) });
  }
  // Vaani's stored transcript of a web call can contain only the agent's lines. If so, use the
  // live captions the browser captured (both sides), which come from the same agent.
  const captured = browserTurns(body?.turns);
  const hasCaller = (t: TranscriptTurn[]) => t.some((x) => x.role === "caller");
  if (!hasCaller(transcript) && hasCaller(captured)) {
    log.info("webcall.using_browser_transcript", { turns: captured.length });
    transcript = captured;
  }
  if (!transcript.length) return Response.json({ ok: true, pending: true });

  // Duration as seen by the browser, capped by the time since we started the call.
  const reported = Number(body?.seconds);
  const seconds = Number.isFinite(reported) && reported > 0 ? Math.min(Math.round(reported), wc.max_s) : null;
  const minutes = seconds != null ? Number((seconds / 60).toFixed(3)) : null;

  const row = await sqlOne<{ id: string }>`
    insert into calls (provider, channel, external_id, status, started_at, ended_at, duration_seconds, vaani_minutes, transcript)
    values (${PROVIDER}, 'phone', ${externalId}, 'received',
            ${seconds != null ? new Date(Date.now() - seconds * 1000).toISOString() : null}, now(), ${seconds}, ${minutes}, ${json(transcript)}::jsonb)
    on conflict (provider, external_id) do update set
      status = 'received',
      started_at = coalesce(calls.started_at, excluded.started_at),
      ended_at = coalesce(calls.ended_at, excluded.ended_at),
      duration_seconds = coalesce(calls.duration_seconds, excluded.duration_seconds),
      vaani_minutes = coalesce(calls.vaani_minutes, excluded.vaani_minutes),
      transcript = excluded.transcript
    where calls.status = 'in_call'
    returning id`;
  const callId =
    row?.id ?? (await sqlOne<{ id: string }>`select id from calls where provider = ${PROVIDER} and external_id = ${externalId}`)?.id;
  if (!callId) return Response.json({ ok: true, pending: true });

  await sql`update web_calls set call_row_id = ${callId} where id = ${wc.id}`;
  if (row) {
    log.info("webcall.finished", { callId });
    after(() => processCall(callId));
  }
  return Response.json({ ok: true, callId });
}
