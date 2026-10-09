import { after } from "next/server";
import { db, must } from "@/lib/db";
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
  const existing = must(
    await db().from("calls").select("id, status").eq("provider", PROVIDER).eq("external_id", call.externalId).maybeSingle(),
    "webhook lookup",
  ) as { id: string; status: string } | null;

  const fields = {
    raw_payload: payload,
    caller_phone: call.callerPhone,
    started_at: call.startedAt,
    ended_at: call.endedAt,
    duration_seconds: call.durationSeconds,
    vaani_minutes: call.durationSeconds != null ? Number((call.durationSeconds / 60).toFixed(3)) : null,
    transcript: call.transcript,
  };

  let callId: string;
  if (!existing) {
    const inserted = await db()
      .from("calls")
      .insert({ provider: PROVIDER, channel: call.channel, external_id: call.externalId, status: "received", ...fields })
      .select("id")
      .single();
    if (inserted.error?.code === "23505") return Response.json({ ok: true, duplicate: true }); // concurrent retry
    callId = (must(inserted, "webhook insert") as { id: string }).id;
  } else if (existing.status === "in_call") {
    // Row was created by a tool call during the conversation; fill in the post-call data.
    must(await db().from("calls").update({ status: "received", ...fields }).eq("id", existing.id), "webhook update");
    callId = existing.id;
  } else {
    log.info("webhook.duplicate", { callId: existing.id, status: existing.status });
    return Response.json({ ok: true, duplicate: true });
  }

  after(() => processCall(callId));
  return Response.json({ ok: true });
}
