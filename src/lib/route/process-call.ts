// Post-call pipeline: claim → classify → plan → execute. Idempotent on the call row:
// - a call is only claimed if it is 'received' or 'failed' (so concurrent retries no-op),
// - an existing classification is reused (no second Gemini charge),
// - every side effect checks for its own record first (handoffs / hubspot_sync / incidents / emails).

import { newAckToken, ackUrl } from "../ack";
import { classifyTranscript } from "../classify/gemini";
import type { StoredClassification } from "../classify/schema";
import { db, must } from "../db";
import { getDesigner, markAssigned, pickDesigner } from "../designers";
import { complianceEmail, existingClientEmail, handoffEmail, needsReviewEmail } from "../email/templates";
import { sendEmail } from "../email/send";
import { appUrl, env } from "../env";
import { createDeal, upsertContact } from "../hubspot";
import { log } from "../log";
import { PriceFigureError, redactPrices } from "../price-guard";
import { formatIst, istDateKey } from "../time";
import { transcriptToText, type CallRow } from "../types";
import { planActions, type Action } from "./plan";

export const MAX_ATTEMPTS = 5;

export function transcriptUrl(callId: string): string {
  return `${appUrl()}/dashboard/calls/${callId}`;
}

export async function processCall(callId: string): Promise<void> {
  const claimed = must(
    await db()
      .from("calls")
      .update({ status: "processing", processing_error: null })
      .eq("id", callId)
      .in("status", ["received", "failed"])
      .lt("processing_attempts", MAX_ATTEMPTS)
      .select("*")
      .maybeSingle(),
    "claim call",
  ) as CallRow | null;
  if (!claimed) return; // already processing / processed / out of attempts

  await db().from("calls").update({ processing_attempts: claimed.processing_attempts + 1 }).eq("id", callId);

  try {
    const c = await ensureClassified(claimed);
    const errors: string[] = [];
    for (const action of planActions({ c, bookingStatus: claimed.booking_status, callerPhone: claimed.caller_phone })) {
      try {
        await runAction(action, claimed, c);
      } catch (err) {
        if (err instanceof PriceFigureError) await recordIncident(claimed.id, "price_guard_blocked", { where: err.where, count: err.hits.length });
        errors.push(`${action.type}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (errors.length) throw new Error(errors.join(" | "));
    must(await db().from("calls").update({ status: "processed" }).eq("id", callId), "mark processed");
    log.info("call.processed", { callId, outcome: c.outcome });
  } catch (err) {
    log.error("call.process_failed", err, { callId });
    await db().from("calls").update({ status: "failed", processing_error: String(err instanceof Error ? err.message : err).slice(0, 2000) }).eq("id", callId);
  }
}

async function ensureClassified(call: CallRow): Promise<StoredClassification> {
  if (call.classification && call.classified_at) return call.classification as StoredClassification;

  const turns = call.transcript ?? [];
  const callDate = istDateKey(new Date(call.started_at ?? call.created_at));
  const { classification, usage } = await classifyTranscript(transcriptToText(turns), callDate);

  must(
    await db()
      .from("calls")
      .update({
        classification,
        outcome: classification.outcome,
        decline_reason: classification.decline_reason,
        review_reason: classification.review_reason,
        classified_at: new Date().toISOString(),
        gemini_input_tokens: usage.inputTokens,
        gemini_output_tokens: usage.outputTokens,
      })
      .eq("id", call.id),
    "store classification",
  );
  return classification;
}

async function runAction(action: Action, call: CallRow, c: StoredClassification): Promise<void> {
  switch (action.type) {
    case "compliance_incident":
      return complianceIncident(call);
    case "hubspot_deal":
      return hubspotDeal(call, c);
    case "designer_handoff":
      return designerHandoff(call, c, action.pendingReview);
    case "urgent_existing_client":
      return void (await sendEmail({
        kind: "urgent_existing_client",
        dedupeKey: `${call.id}:urgent_existing_client`,
        callId: call.id,
        to: [env("NIKHIL_EMAIL"), env("ESCALATION_EMAIL")],
        ...existingClientEmail({ c, callerPhone: call.caller_phone, transcriptUrl: transcriptUrl(call.id), endedAt: call.ended_at }),
      }));
    case "needs_review_email": {
      const designer = call.designer_id ? await getDesigner(call.designer_id) : null;
      return void (await sendEmail({
        kind: "needs_review",
        dedupeKey: `${call.id}:needs_review`,
        callId: call.id,
        to: [env("NIKHIL_EMAIL")],
        ...needsReviewEmail({ c, callerPhone: call.caller_phone, transcriptUrl: transcriptUrl(call.id), reason: action.reason, bookingStart: call.booking_start, designerName: designer?.name ?? null }),
      }));
    }
    case "callback_list":
      return; // the dashboard lists dropped calls with a number; nothing to write
  }
}

async function recordIncident(callId: string, type: string, details: Record<string, unknown>): Promise<boolean> {
  const res = await db().from("incidents").insert({ call_id: callId, type, details });
  if (res.error?.code === "23505") return false; // already recorded
  if (res.error) throw new Error(`incident insert: ${res.error.message}`);
  return true;
}

async function complianceIncident(call: CallRow): Promise<void> {
  await recordIncident(call.id, "price_mentioned_by_agent", { detected_by: "classifier" });
  await sendEmail({
    kind: "compliance",
    dedupeKey: `${call.id}:compliance`,
    callId: call.id,
    to: [env("NIKHIL_EMAIL")],
    ...complianceEmail({ callId: call.id, transcriptUrl: transcriptUrl(call.id), endedAt: call.ended_at }),
  });
  await db().from("incidents").update({ notified_at: new Date().toISOString() }).eq("call_id", call.id).eq("type", "price_mentioned_by_agent");
}

async function resolveDesigner(call: CallRow, c: StoredClassification) {
  if (call.designer_id) {
    const d = await getDesigner(call.designer_id);
    if (d) return d;
  }
  const d = await pickDesigner(c.fields.location);
  if (!d) throw new Error("No active designer to assign");
  await markAssigned(d.id);
  must(await db().from("calls").update({ designer_id: d.id }).eq("id", call.id), "assign designer");
  call.designer_id = d.id;
  return d;
}

async function designerHandoff(call: CallRow, c: StoredClassification, pendingReview: boolean): Promise<void> {
  const designer = await resolveDesigner(call, c);

  // Reuse an existing handoff row on retry; a fresh token is only issued if the email never went out.
  const existing = must(
    await db().from("handoffs").select("id, email_sent_at").eq("call_id", call.id).maybeSingle(),
    "handoff lookup",
  ) as { id: string; email_sent_at: string | null } | null;
  if (existing?.email_sent_at) return;

  const { token, hash, expiresAt } = newAckToken();
  must(
    await db()
      .from("handoffs")
      .upsert({ call_id: call.id, designer_id: designer.id, ack_token: hash, ack_expires_at: expiresAt.toISOString() }, { onConflict: "call_id" }),
    "handoff upsert",
  );

  const rendered = handoffEmail({
    c,
    callerPhone: call.caller_phone,
    designerName: designer.name,
    bookingStatus: call.booking_status,
    bookingStart: call.booking_start,
    consultationMode: call.consultation_mode,
    ackUrl: ackUrl(token),
    transcriptUrl: transcriptUrl(call.id),
    pendingReview,
  });

  // A booking failure means a 2-hour callback promise: copy Nikhil so it can't slip.
  const to = call.booking_status === "booking_failed" ? [designer.email, env("NIKHIL_EMAIL")] : [designer.email];
  await sendEmail({ kind: "handoff", dedupeKey: `${call.id}:handoff`, callId: call.id, to, ...rendered });
  must(await db().from("handoffs").update({ email_sent_at: new Date().toISOString() }).eq("call_id", call.id), "handoff sent");
}

export function dealDescription(c: StoredClassification, bookingStart: string | null, designerName: string | null): string {
  const f = c.fields;
  const lines = [
    bookingStart ? `Consultation: ${formatIst(bookingStart, { withYear: true })} IST${designerName ? ` with ${designerName}` : ""}` : "Consultation: not booked on the call",
    `Caller: "${c.caller_quote}"`,
    `Location: ${f.location ?? "-"}`,
    `Property: ${f.property_type ?? "-"}${f.carpet_area_sqft ? `, ${f.carpet_area_sqft} sq ft` : ""}`,
    `Scope: ${f.scope ?? "-"}`,
    `Current state: ${f.current_state ?? "-"}`,
    `Needed by: ${f.needed_by ?? "-"}`,
    `Decision-maker: ${f.decision_maker ?? "-"} (${f.decision_maker_confirmed ? "confirmed" : "not confirmed"})`,
    `Budget: ${f.budget_volunteered ? "mentioned by caller (see transcript)" : "not discussed"}`,
    `Source: ${f.source ?? "-"}`,
    c.flags.length ? `Flags: ${c.flags.join("; ")}` : "",
  ];
  return redactPrices(lines.filter(Boolean).join("\n"));
}

async function hubspotDeal(call: CallRow, c: StoredClassification): Promise<void> {
  const existing = must(await db().from("hubspot_sync").select("deal_id").eq("call_id", call.id).maybeSingle(), "hubspot_sync lookup") as { deal_id: string | null } | null;
  if (existing?.deal_id) return;

  const designer = await resolveDesigner(call, c);
  const contactId = await upsertContact({ name: c.fields.name, phone: c.fields.phone || call.caller_phone, location: c.fields.location });
  const dealName = redactPrices(`${c.fields.name ?? "Unknown"}, ${c.fields.property_type ?? "project"} in ${c.fields.location ?? "Pune"}`);
  const deal = await createDeal({ name: dealName, description: dealDescription(c, call.booking_start, designer.name), contactId, consultationAt: call.booking_start });

  must(
    await db().from("hubspot_sync").upsert(
      { call_id: call.id, contact_id: contactId, deal_id: deal.id, deal_stage: deal.stage, synced_at: new Date().toISOString() },
      { onConflict: "call_id" },
    ),
    "hubspot_sync upsert",
  );
}
