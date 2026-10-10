import { isAuthorizedCron } from "@/lib/cron";
import { sql } from "@/lib/db";
import { hubspotEnabled, readDeals } from "@/lib/hubspot";

export const maxDuration = 60;

/** Hourly: pull current stage (and human-entered amount on won deals) for every deal we created. */
export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) return new Response("unauthorized", { status: 401 });
  if (!hubspotEnabled()) return Response.json({ ok: true, skipped: "HubSpot not configured" });

  const rows = await sql<{ call_id: string; deal_id: string }>`select call_id, deal_id from hubspot_sync where deal_id is not null`;
  const states = new Map((await readDeals(rows.map((r) => r.deal_id))).map((s) => [s.id, s]));

  let updated = 0;
  for (const r of rows) {
    const s = states.get(r.deal_id);
    if (!s) continue; // deleted in HubSpot
    await sql`
      update hubspot_sync set deal_stage = ${s.stage}, is_closed = ${s.isClosed}, is_closed_won = ${s.isClosedWon},
        won_amount = ${s.amount}, synced_at = now()
      where call_id = ${r.call_id}`;
    updated++;
  }
  return Response.json({ ok: true, deals: rows.length, updated });
}
