import { isAuthorizedCron } from "@/lib/cron";
import { db, must } from "@/lib/db";
import { readDeals } from "@/lib/hubspot";

export const maxDuration = 60;

/** Hourly: pull current stage (and human-entered amount on won deals) for every deal we created. */
export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) return new Response("unauthorized", { status: 401 });

  const rows = must(await db().from("hubspot_sync").select("call_id, deal_id").not("deal_id", "is", null), "sync rows") as { call_id: string; deal_id: string }[];
  const states = new Map((await readDeals(rows.map((r) => r.deal_id))).map((s) => [s.id, s]));
  const now = new Date().toISOString();

  let updated = 0;
  for (const r of rows) {
    const s = states.get(r.deal_id);
    if (!s) continue; // deleted in HubSpot
    must(
      await db()
        .from("hubspot_sync")
        .update({ deal_stage: s.stage, is_closed: s.isClosed, is_closed_won: s.isClosedWon, won_amount: s.amount, synced_at: now })
        .eq("call_id", r.call_id),
      "sync update",
    );
    updated++;
  }
  return Response.json({ ok: true, deals: rows.length, updated });
}
