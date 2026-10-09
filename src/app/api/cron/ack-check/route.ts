import type { StoredClassification } from "@/lib/classify/schema";
import { isAuthorizedCron } from "@/lib/cron";
import { db, must } from "@/lib/db";
import { sendEmail } from "@/lib/email/send";
import { unacknowledgedEmail } from "@/lib/email/templates";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { designerMap } from "@/lib/metrics";
import { MAX_ATTEMPTS, processCall, transcriptUrl } from "@/lib/route/process-call";

export const maxDuration = 60;

const ACK_WINDOW_MS = 2 * 60 * 60 * 1000;

/**
 * Every 15 minutes:
 * 1. Escalate handoffs not acknowledged within 2 hours (once each).
 * 2. Retry calls whose post-call processing failed or never ran (safety net for after()).
 */
export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) return new Response("unauthorized", { status: 401 });

  const cutoff = new Date(Date.now() - ACK_WINDOW_MS).toISOString();
  const overdue = must(
    await db()
      .from("handoffs")
      .select("call_id, designer_id, email_sent_at, calls(classification)")
      .is("acknowledged_at", null)
      .is("escalated_at", null)
      .not("email_sent_at", "is", null)
      .lt("email_sent_at", cutoff),
    "overdue handoffs",
  ) as unknown as { call_id: string; designer_id: string; email_sent_at: string; calls: { classification: StoredClassification | null } | null }[];

  const designers = overdue.length ? await designerMap() : new Map();
  let escalated = 0;
  for (const h of overdue) {
    try {
      const leadName = h.calls?.classification?.fields.name ?? "Unknown caller";
      const designerName = designers.get(h.designer_id)?.name ?? "unknown designer";
      await sendEmail({
        kind: "unacknowledged",
        dedupeKey: `${h.call_id}:unacknowledged`,
        callId: h.call_id,
        to: [env("NIKHIL_EMAIL")],
        ...unacknowledgedEmail({ leadName, designerName, emailSentAt: h.email_sent_at, transcriptUrl: transcriptUrl(h.call_id) }),
      });
      await db().from("handoffs").update({ escalated_at: new Date().toISOString() }).eq("call_id", h.call_id);
      escalated++;
    } catch (err) {
      log.error("cron.ack_check.escalate_failed", err, { callId: h.call_id });
    }
  }

  // Retry: failed, or 'received' for more than 2 minutes (after() never ran / crashed).
  const stale = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const retry = must(
    await db()
      .from("calls")
      .select("id")
      .lt("processing_attempts", MAX_ATTEMPTS)
      .or(`status.eq.failed,and(status.eq.received,updated_at.lt.${stale})`)
      .limit(20),
    "retry calls",
  ) as { id: string }[];
  for (const c of retry) await processCall(c.id);

  // Calls stuck in 'processing' > 10 minutes (function killed mid-run) → back to failed for next tick.
  const stuck = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  await db().from("calls").update({ status: "failed", processing_error: "processing timed out" }).eq("status", "processing").lt("updated_at", stuck);

  return Response.json({ escalated, retried: retry.length });
}
