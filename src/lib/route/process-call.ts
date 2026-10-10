// Post-call pipeline: claim → classify → plan → execute. Idempotent on the call row:
// - a call is only claimed if it is 'received' or 'failed' (so concurrent retries no-op),
// - an existing classification is reused (no second Gemini charge),
// - every side effect checks for its own record first (handoffs / hubspot_sync / incidents / emails).

import { newAckToken, ackUrl } from "../ack";
import { classifyTranscript } from "../classify/gemini";
import type { StoredClassification } from "../classify/schema";
import { json, sql, sqlOne } from "../db";
import { getDesigner, markAssigned, pickDesigner } from "../designers";
import { complianceEmail, existingClientEmail, handoffEmail, needsReviewEmail, policyEmail } from "../email/templates";
import { sendEmail } from "../email/send";
import { appUrl, env } from "../env";
import { toInternationalPhone } from "../calcom";
import { createDeal, hubspotEnabled, upsertContact } from "../hubspot";
import { pendingCallKey } from "../tools";
import { log } from "../log";
import { BlockedContentError, redactForDisplay } from "../price-guard";
import { formatIst, istDateKey } from "../time";
import { transcriptToText, type CallRow } from "../types";
import { planActions, type Action } from "./plan";

export const MAX_ATTEMPTS = 5;

export function transcriptUrl(callId: string): string {
  return `${appUrl()}/dashboard/calls/${callId}`;
}

export async function processCall(callId: string): Promise<void> {
  const claimed = await sqlOne<CallRow>`
    update calls set status = 'processing', processing_error = null, processing_attempts = processing_attempts + 1
    where id = ${callId} and processing_attempts < ${MAX_ATTEMPTS}
      and (status in ('received', 'failed')
           -- a run killed mid-way (function timeout) is reclaimed after 3 minutes
           or (status = 'processing' and updated_at < now() - interval '3 minutes'))
    returning *`;
  if (!claimed) return; // already processing / processed / out of attempts

  try {
    const c = await ensureClassified(claimed);
    await adoptPendingBooking(claimed, c);
    const errors: string[] = [];
    for (const action of planActions({ c, bookingStatus: claimed.booking_status, callerPhone: claimed.caller_phone })) {
      try {
        await runAction(action, claimed, c);
      } catch (err) {
        if (err instanceof BlockedContentError) await recordIncident(claimed.id, "price_guard_blocked", { where: err.where, count: err.hits.length });
        errors.push(`${action.type}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (errors.length) throw new Error(errors.join(" | "));
    await sql`update calls set status = 'processed' where id = ${callId}`;
    log.info("call.processed", { callId, outcome: c.outcome });
  } catch (err) {
    log.error("call.process_failed", err, { callId });
    const message = String(err instanceof Error ? err.message : err).slice(0, 2000);
    await sql`update calls set status = 'failed', processing_error = ${message} where id = ${callId}`;
  }
}

/**
 * Web calls (and any provider that doesn't send a call id to tools) leave the booking on a
 * `pending:<phone>` row. Once the transcript tells us the caller's number, move that booking
 * onto this call so the designer brief and dashboard show it.
 */
async function adoptPendingBooking(call: CallRow, c: StoredClassification): Promise<void> {
  if (call.booking_status !== "none") return;
  const phone = toInternationalPhone(c.fields.phone) ?? toInternationalPhone(call.caller_phone);
  if (!phone) return;
  const pending = await sqlOne<Pick<CallRow, "id" | "designer_id" | "booking_status" | "booking_uid" | "booking_start" | "consultation_mode">>`
    select id, designer_id, booking_status, booking_uid, booking_start, consultation_mode from calls
    where provider = ${call.provider} and external_id = ${pendingCallKey(phone)} and status = 'in_call'
      and id <> ${call.id} and created_at > now() - interval '3 hours'
    order by created_at desc limit 1`;
  if (!pending || pending.booking_status === "none") return;
  await sql`
    update calls set designer_id = coalesce(designer_id, ${pending.designer_id}), booking_status = ${pending.booking_status},
      booking_uid = ${pending.booking_uid}, booking_start = ${pending.booking_start}, consultation_mode = ${pending.consultation_mode},
      caller_phone = coalesce(caller_phone, ${phone})
    where id = ${call.id}`;
  await sql`delete from calls where id = ${pending.id}`;
  Object.assign(call, {
    designer_id: call.designer_id ?? pending.designer_id,
    booking_status: pending.booking_status,
    booking_uid: pending.booking_uid,
    booking_start: pending.booking_start,
    consultation_mode: pending.consultation_mode,
    caller_phone: call.caller_phone ?? phone,
  });
  log.info("call.adopted_pending_booking", { callId: call.id });
}

async function ensureClassified(call: CallRow): Promise<StoredClassification> {
  if (call.classification && call.classified_at) return call.classification as StoredClassification;

  const turns = call.transcript ?? [];
  const callDate = istDateKey(new Date(call.started_at ?? call.created_at));
  const { classification, usage } = await classifyTranscript(transcriptToText(turns), callDate);

  await sql`
    update calls set
      classification = ${json(classification)}::jsonb,
      outcome = ${classification.outcome},
      decline_reason = ${classification.decline_reason},
      review_reason = ${classification.review_reason},
      classified_at = now(),
      gemini_input_tokens = ${usage.inputTokens},
      gemini_output_tokens = ${usage.outputTokens}
    where id = ${call.id}`;
  return classification;
}

async function runAction(action: Action, call: CallRow, c: StoredClassification): Promise<void> {
  switch (action.type) {
    case "compliance_incident":
      return complianceIncident(call);
    case "policy_incident":
      return policyIncident(call, action.violations);
    case "hubspot_deal":
      if (!hubspotEnabled()) return log.info("hubspot.skipped_not_configured", { callId: call.id });
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

async function recordIncident(callId: string, type: string, details: Record<string, unknown>): Promise<void> {
  await sql`insert into incidents (call_id, type, details) values (${callId}, ${type}, ${json(details)}::jsonb) on conflict (call_id, type) do nothing`;
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
  await sql`update incidents set notified_at = now() where call_id = ${call.id} and type = 'price_mentioned_by_agent'`;
}

async function policyIncident(call: CallRow, violations: string[]): Promise<void> {
  await recordIncident(call.id, "agent_policy_violation", { violations });
  await sendEmail({
    kind: "policy",
    dedupeKey: `${call.id}:policy`,
    callId: call.id,
    to: [env("NIKHIL_EMAIL")],
    ...policyEmail({ violations, transcriptUrl: transcriptUrl(call.id), endedAt: call.ended_at }),
  });
  await sql`update incidents set notified_at = now() where call_id = ${call.id} and type = 'agent_policy_violation'`;
}

async function resolveDesigner(call: CallRow, c: StoredClassification) {
  if (call.designer_id) {
    const d = await getDesigner(call.designer_id);
    if (d) return d;
  }
  const d = await pickDesigner(c.fields.location);
  if (!d) throw new Error("No active designer to assign");
  await markAssigned(d.id);
  await sql`update calls set designer_id = ${d.id} where id = ${call.id}`;
  call.designer_id = d.id;
  return d;
}

async function designerHandoff(call: CallRow, c: StoredClassification, pendingReview: boolean): Promise<void> {
  const designer = await resolveDesigner(call, c);

  // Reuse an existing handoff row on retry; a fresh token is only issued if the email never went out.
  const existing = await sqlOne<{ email_sent_at: string | null }>`select email_sent_at from handoffs where call_id = ${call.id}`;
  if (existing?.email_sent_at) return;

  const { token, hash, expiresAt } = newAckToken();
  await sql`
    insert into handoffs (call_id, designer_id, ack_token, ack_expires_at)
    values (${call.id}, ${designer.id}, ${hash}, ${expiresAt.toISOString()})
    on conflict (call_id) do update set designer_id = excluded.designer_id, ack_token = excluded.ack_token, ack_expires_at = excluded.ack_expires_at`;

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
  await sql`update handoffs set email_sent_at = now() where call_id = ${call.id}`;
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
  return redactForDisplay(lines.filter(Boolean).join("\n"));
}

async function hubspotDeal(call: CallRow, c: StoredClassification): Promise<void> {
  const existing = await sqlOne<{ deal_id: string | null }>`select deal_id from hubspot_sync where call_id = ${call.id}`;
  if (existing?.deal_id) return;

  const designer = await resolveDesigner(call, c);
  const contactId = await upsertContact({ name: c.fields.name, phone: c.fields.phone || call.caller_phone, location: c.fields.location });
  const dealName = redactForDisplay(`${c.fields.name ?? "Unknown"}, ${c.fields.property_type ?? "project"} in ${c.fields.location ?? "Pune"}`);
  const deal = await createDeal({ name: dealName, description: dealDescription(c, call.booking_start, designer.name), contactId, consultationAt: call.booking_start });

  await sql`
    insert into hubspot_sync (call_id, contact_id, deal_id, deal_stage, synced_at)
    values (${call.id}, ${contactId}, ${deal.id}, ${deal.stage}, now())
    on conflict (call_id) do update set contact_id = excluded.contact_id, deal_id = excluded.deal_id, deal_stage = excluded.deal_stage, synced_at = now()`;
}
