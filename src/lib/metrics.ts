// Dashboard + digest numbers. Volumes are small (~200 calls/month), so we pull rows for the
// range and aggregate in code rather than maintaining SQL views.

import type { StoredClassification } from "./classify/schema";
import { db, must } from "./db";
import { envRate } from "./env";
import { isAfterHours } from "./time";
import type { CallRow, Designer } from "./types";

export interface HandoffRow {
  call_id: string;
  designer_id: string;
  email_sent_at: string | null;
  acknowledged_at: string | null;
  escalated_at: string | null;
}

export interface Stats {
  median: number | null;
  max: number | null;
  count: number;
}

export function stats(values: number[]): Stats {
  if (!values.length) return { median: null, max: null, count: 0 };
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return { median: s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2, max: s.at(-1)!, count: s.length };
}

const secondsBetween = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 1000;

export interface Metrics {
  total: number;
  afterHours: number;
  avgDurationSeconds: number | null;
  outcomes: Record<string, number>;
  declineReasons: Record<string, number>;
  pendingClassification: number;
  booked: number;
  bookingFailed: number;
  handoffLatency: Stats; // call end → handoff email sent
  ackLatency: Stats; // email sent → designer acknowledged
  unacknowledged: number;
  pricingRequested: number;
  complianceIncidents: number;
  cost: {
    vaani: number;
    gemini: number;
    email: number;
    total: number;
    perCall: number | null;
    perQualified: number | null;
    vaaniMinutes: number;
    geminiTokens: { input: number; output: number };
    emailsSent: number;
    missingRates: string[];
    currency: string;
  };
}

export interface RangeData {
  calls: CallRow[];
  handoffs: HandoffRow[];
  incidents: { call_id: string | null; type: string; created_at: string }[];
  emailsSent: number;
}

export async function loadRange(start: Date, end: Date): Promise<RangeData> {
  const [calls, emails, incidents] = await Promise.all([
    db().from("calls").select("*").neq("status", "in_call").gte("created_at", start.toISOString()).lt("created_at", end.toISOString()).order("created_at", { ascending: false }),
    db().from("emails").select("id", { count: "exact", head: true }).not("sent_at", "is", null).gte("sent_at", start.toISOString()).lt("sent_at", end.toISOString()),
    db().from("incidents").select("call_id, type, created_at").gte("created_at", start.toISOString()).lt("created_at", end.toISOString()),
  ]);
  const callRows = must(calls, "metrics calls") as CallRow[];
  if (emails.error) throw new Error(`metrics emails: ${emails.error.message}`);
  const ids = callRows.map((c) => c.id);
  const handoffs = ids.length
    ? (must(await db().from("handoffs").select("call_id, designer_id, email_sent_at, acknowledged_at, escalated_at").in("call_id", ids), "metrics handoffs") as HandoffRow[])
    : [];
  return { calls: callRows, handoffs, incidents: must(incidents, "metrics incidents") as RangeData["incidents"], emailsSent: emails.count ?? 0 };
}

export function computeMetrics(d: RangeData): Metrics {
  const { calls, handoffs } = d;
  const count = (keyOf: (c: CallRow) => string | null) =>
    calls.reduce<Record<string, number>>((acc, c) => {
      const k = keyOf(c);
      if (k) acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});

  const durations = calls.map((c) => c.duration_seconds).filter((x): x is number => x != null);
  const byCall = new Map(calls.map((c) => [c.id, c]));

  const handoffLatency = stats(
    handoffs.flatMap((h) => {
      const c = byCall.get(h.call_id);
      return h.email_sent_at && c?.ended_at ? [secondsBetween(c.ended_at, h.email_sent_at)] : [];
    }),
  );
  const ackLatency = stats(handoffs.flatMap((h) => (h.email_sent_at && h.acknowledged_at ? [secondsBetween(h.email_sent_at, h.acknowledged_at)] : [])));

  const vaaniRate = envRate("VAANI_COST_PER_MIN");
  const gemIn = envRate("GEMINI_COST_PER_1M_INPUT_TOKENS");
  const gemOut = envRate("GEMINI_COST_PER_1M_OUTPUT_TOKENS");
  const emailRate = envRate("RESEND_COST_PER_EMAIL");
  const missingRates = (
    [
      ["VAANI_COST_PER_MIN", vaaniRate],
      ["GEMINI_COST_PER_1M_INPUT_TOKENS", gemIn],
      ["GEMINI_COST_PER_1M_OUTPUT_TOKENS", gemOut],
      ["RESEND_COST_PER_EMAIL", emailRate],
    ] as const
  )
    .filter(([, r]) => r.missing)
    .map(([n]) => n);

  const vaaniMinutes = calls.reduce((s, c) => s + Number(c.vaani_minutes ?? 0), 0);
  const tokIn = calls.reduce((s, c) => s + (c.gemini_input_tokens ?? 0), 0);
  const tokOut = calls.reduce((s, c) => s + (c.gemini_output_tokens ?? 0), 0);
  const vaani = vaaniMinutes * vaaniRate.value;
  const gemini = (tokIn / 1e6) * gemIn.value + (tokOut / 1e6) * gemOut.value;
  const email = d.emailsSent * emailRate.value;
  const total = vaani + gemini + email;
  const qualified = calls.filter((c) => c.outcome === "qualified").length;

  return {
    total: calls.length,
    afterHours: calls.filter((c) => isAfterHours(new Date(c.started_at ?? c.created_at))).length,
    avgDurationSeconds: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
    outcomes: count((c) => c.outcome),
    declineReasons: count((c) => (c.outcome === "declined" ? c.decline_reason : null)),
    pendingClassification: calls.filter((c) => !c.outcome).length,
    booked: calls.filter((c) => c.booking_status === "booked").length,
    bookingFailed: calls.filter((c) => c.booking_status === "booking_failed").length,
    handoffLatency,
    ackLatency,
    unacknowledged: handoffs.filter((h) => h.email_sent_at && !h.acknowledged_at).length,
    pricingRequested: calls.filter((c) => (c.classification as StoredClassification | null)?.pricing_requested).length,
    complianceIncidents: d.incidents.filter((i) => i.type === "price_mentioned_by_agent").length,
    cost: {
      vaani,
      gemini,
      email,
      total,
      perCall: calls.length ? total / calls.length : null,
      perQualified: qualified ? total / qualified : null,
      vaaniMinutes,
      geminiTokens: { input: tokIn, output: tokOut },
      emailsSent: d.emailsSent,
      missingRates,
      currency: process.env.COST_CURRENCY || "INR",
    },
  };
}

export interface Pipeline {
  openDeals: number;
  wonDeals: number;
  wonValue: number | null; // sum of human-entered HubSpot amounts on won deals; null if none entered
  lastSyncedAt: string | null;
}

export async function loadPipeline(): Promise<Pipeline> {
  const rows = must(await db().from("hubspot_sync").select("deal_id, is_closed, is_closed_won, won_amount, synced_at").not("deal_id", "is", null), "pipeline") as {
    is_closed: boolean;
    is_closed_won: boolean;
    won_amount: number | null;
    synced_at: string;
  }[];
  const won = rows.filter((r) => r.is_closed_won);
  const amounts = won.map((r) => r.won_amount).filter((a): a is number => a != null);
  return {
    openDeals: rows.filter((r) => !r.is_closed).length,
    wonDeals: won.length,
    wonValue: amounts.length ? amounts.reduce((a, b) => a + Number(b), 0) : null,
    lastSyncedAt: rows.map((r) => r.synced_at).sort().at(-1) ?? null,
  };
}

/** Dropped calls with a number that nobody has called back yet (last 30 days). */
export async function loadCallbacks(): Promise<CallRow[]> {
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  return must(
    await db().from("calls").select("*").eq("outcome", "dropped").is("callback_done_at", null).not("caller_phone", "is", null).gte("created_at", since).order("created_at", { ascending: false }),
    "callbacks",
  ) as CallRow[];
}

export async function designerMap(): Promise<Map<string, Designer>> {
  const rows = must(await db().from("designers").select("*"), "designers") as Designer[];
  return new Map(rows.map((d) => [d.id, d]));
}
