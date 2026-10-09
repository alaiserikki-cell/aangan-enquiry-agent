import { isAuthorizedCron } from "@/lib/cron";
import { sql } from "@/lib/db";
import { sendEmail } from "@/lib/email/send";
import { unacknowledgedEmail } from "@/lib/email/templates";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { designerMap } from "@/lib/metrics";
import { MAX_ATTEMPTS, processCall, transcriptUrl } from "@/lib/route/process-call";

export const maxDuration = 60;

/**
 * Every 15 minutes:
 * 1. Escalate handoffs not acknowledged within 2 hours (once each).
 * 2. Retry calls whose post-call processing failed or never ran (safety net for after()).
 */
export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) return new Response("unauthorized", { status: 401 });

  const overdue = await sql<{ call_id: string; designer_id: string; email_sent_at: string; lead_name: string | null }>`
    select h.call_id, h.designer_id, h.email_sent_at, c.classification->'fields'->>'name' as lead_name
    from handoffs h join calls c on c.id = h.call_id
    where h.acknowledged_at is null and h.escalated_at is null
      and h.email_sent_at is not null and h.email_sent_at < now() - interval '2 hours'`;

  const designers = overdue.length ? await designerMap() : new Map();
  let escalated = 0;
  for (const h of overdue) {
    try {
      await sendEmail({
        kind: "unacknowledged",
        dedupeKey: `${h.call_id}:unacknowledged`,
        callId: h.call_id,
        to: [env("NIKHIL_EMAIL")],
        ...unacknowledgedEmail({
          leadName: h.lead_name ?? "Unknown caller",
          designerName: designers.get(h.designer_id)?.name ?? "unknown designer",
          emailSentAt: h.email_sent_at,
          transcriptUrl: transcriptUrl(h.call_id),
        }),
      });
      await sql`update handoffs set escalated_at = now() where call_id = ${h.call_id}`;
      escalated++;
    } catch (err) {
      log.error("cron.ack_check.escalate_failed", err, { callId: h.call_id });
    }
  }

  // Calls stuck in 'processing' > 10 minutes (function killed mid-run) → failed, so they retry below.
  await sql`update calls set status = 'failed', processing_error = 'processing timed out' where status = 'processing' and updated_at < now() - interval '10 minutes'`;

  // Retry: failed, or 'received' for more than 2 minutes (after() never ran / crashed).
  const retry = await sql<{ id: string }>`
    select id from calls
    where processing_attempts < ${MAX_ATTEMPTS}
      and (status = 'failed' or (status = 'received' and updated_at < now() - interval '2 minutes'))
    order by created_at limit 20`;
  for (const c of retry) await processCall(c.id);

  return Response.json({ escalated, retried: retry.length });
}
