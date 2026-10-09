import { isAuthorizedCron } from "@/lib/cron";
import { sql } from "@/lib/db";
import { sendEmail } from "@/lib/email/send";
import { digestEmail } from "@/lib/email/templates";
import { appUrl, env } from "@/lib/env";
import { computeMetrics, designerMap, loadCallbacks, loadRange } from "@/lib/metrics";
import { transcriptUrl } from "@/lib/route/process-call";
import { istYesterday } from "@/lib/time";

export const maxDuration = 60;

/** 08:45 IST (03:15 UTC) daily: yesterday's calls for Nikhil. */
export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) return new Response("unauthorized", { status: 401 });

  const { start, end, label } = istYesterday();
  const m = computeMetrics(await loadRange(start, end));

  // Unacknowledged = all still-open handoffs, not just yesterday's.
  const open = await sql<{ call_id: string; designer_id: string; email_sent_at: string; lead_name: string | null }>`
    select h.call_id, h.designer_id, h.email_sent_at, c.classification->'fields'->>'name' as lead_name
    from handoffs h join calls c on c.id = h.call_id
    where h.acknowledged_at is null and h.email_sent_at is not null
    order by h.email_sent_at`;
  const designers = await designerMap();
  const callbacks = await loadCallbacks();

  await sendEmail({
    kind: "digest",
    dedupeKey: `digest:${label}`,
    to: [env("NIKHIL_EMAIL")],
    ...digestEmail({
      dateLabel: label,
      total: m.total,
      afterHours: m.afterHours,
      avgDurationSeconds: m.avgDurationSeconds,
      outcomes: m.outcomes,
      declineReasons: m.declineReasons,
      booked: m.booked,
      bookingFailed: m.bookingFailed,
      incidents: m.complianceIncidents,
      unacknowledged: open.map((h) => ({
        name: h.lead_name ?? "Unknown caller",
        designer: designers.get(h.designer_id)?.name ?? "unknown",
        sentAt: h.email_sent_at,
        url: transcriptUrl(h.call_id),
      })),
      // Digest goes to Nikhil only; the phone number is shown as on the dashboard.
      callbacks: callbacks.map((c) => ({ phone: c.caller_phone!, at: c.started_at ?? c.created_at, url: transcriptUrl(c.id) })),
      dashboardUrl: `${appUrl()}/dashboard`,
    }),
  });

  return Response.json({ ok: true, date: label });
}
