// Chart-ready shapes for the dashboard: time buckets, hour-of-day, funnel, deltas.
// Pure functions over CallRow / HandoffRow so demo data and real data share one path.

import { isAfterHours, startOfIstDay, type RangeKey } from "./time";
import type { HandoffRow } from "./metrics";
import type { CallRow } from "./types";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Outcome groups for stacked charts: four slots max, the rest fold into "Other". */
export const OUTCOME_GROUPS = ["qualified", "declined", "needs_review", "other"] as const;
export type OutcomeGroup = (typeof OUTCOME_GROUPS)[number];
export const OUTCOME_GROUP_LABEL: Record<OutcomeGroup, string> = {
  qualified: "Qualified",
  declined: "Declined",
  needs_review: "Needs review",
  other: "Other",
};

export function outcomeGroup(outcome: string | null): OutcomeGroup {
  if (outcome === "qualified" || outcome === "declined" || outcome === "needs_review") return outcome;
  return "other"; // existing client, not a lead, dropped, unclassified
}

export interface Bucket {
  key: string;
  label: string; // axis label
  title: string; // tooltip title
  counts: Record<OutcomeGroup, number>;
  total: number;
  booked: number;
}

const when = (c: CallRow) => new Date(c.started_at ?? c.created_at);
const ist = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS);

/** Today → 24 hourly buckets; week/month → one bucket per IST day in the range. */
export function timeBuckets(calls: CallRow[], range: RangeKey, start: Date, end: Date): Bucket[] {
  const empty = (): Record<OutcomeGroup, number> => ({ qualified: 0, declined: 0, needs_review: 0, other: 0 });
  const buckets: Bucket[] = [];

  if (range === "today") {
    for (let h = 0; h < 24; h++) {
      const label = h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`;
      buckets.push({ key: String(h), label, title: `${label.replace("a", " am").replace("p", " pm")} hour`, counts: empty(), total: 0, booked: 0 });
    }
  } else {
    // Stop at today: future days in the range would only be empty columns.
    const last = Math.min(end.getTime(), startOfIstDay(new Date()).getTime() + 864e5);
    for (let t = start.getTime(); t < last; t += 864e5) {
      const d = ist(new Date(t));
      const key = d.toISOString().slice(0, 10);
      const weekday = d.toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" });
      const label = range === "week" ? weekday : String(d.getUTCDate());
      const title = d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
      buckets.push({ key, label, title, counts: empty(), total: 0, booked: 0 });
    }
  }

  const index = new Map(buckets.map((b, i) => [b.key, i]));
  for (const c of calls) {
    const d = ist(when(c));
    const key = range === "today" ? String(d.getUTCHours()) : d.toISOString().slice(0, 10);
    const i = index.get(key);
    if (i === undefined) continue;
    const b = buckets[i];
    b.counts[outcomeGroup(c.outcome)]++;
    b.total++;
    if (c.booking_status === "booked") b.booked++;
  }
  return buckets;
}

export interface HourSlot {
  hour: number;
  label: string;
  afterHours: boolean;
  count: number;
}

/** Calls by IST hour of day; flags hours outside the 10am–7pm front desk. */
export function hourOfDay(calls: CallRow[]): HourSlot[] {
  const slots: HourSlot[] = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    label: h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`,
    afterHours: h < 10 || h >= 19,
    count: 0,
  }));
  for (const c of calls) slots[ist(when(c)).getUTCHours()].count++;
  return slots;
}

export interface FunnelStep {
  label: string;
  value: number;
  note: string;
}

/** Calls → qualified → booked → designer acknowledged. */
export function funnel(calls: CallRow[], handoffs: HandoffRow[]): FunnelStep[] {
  const total = calls.length;
  const qualified = calls.filter((c) => c.outcome === "qualified").length;
  const booked = calls.filter((c) => c.outcome === "qualified" && c.booking_status === "booked").length;
  const qualifiedIds = new Set(calls.filter((c) => c.outcome === "qualified").map((c) => c.id));
  const acked = handoffs.filter((h) => qualifiedIds.has(h.call_id) && h.acknowledged_at).length;
  const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "–");
  return [
    { label: "Calls answered", value: total, note: "" },
    { label: "Qualified", value: qualified, note: `${pct(qualified, total)} of calls` },
    { label: "Consultation booked", value: booked, note: `${pct(booked, qualified)} of qualified` },
    { label: "Designer acknowledged", value: acked, note: `${pct(acked, qualified)} of qualified` },
  ];
}

export interface Delta {
  /** Signed change vs the previous period, or null when there is nothing to compare. */
  change: number | null;
  /** "up" is good for this metric? Drives the colour of the delta. */
  upIsGood: boolean;
}

export function delta(current: number | null, previous: number | null, upIsGood = true): Delta {
  if (current === 0 && previous === 0) return { change: 0, upIsGood };
  if (current == null || previous == null || previous === 0) return { change: null, upIsGood };
  return { change: (current - previous) / previous, upIsGood };
}

/**
 * The comparison window: the previous period, cut to the same elapsed time as the current
 * one, so a half-finished week is compared with the same half of last week.
 */
export function previousRange(range: RangeKey, start: Date, end: Date, now = new Date()): { start: Date; end: Date; label: string } {
  const elapsed = Math.max(0, Math.min(now.getTime(), end.getTime()) - start.getTime());
  let prevStart: Date;
  if (range === "month") {
    const s = ist(start);
    prevStart = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() - 1, 1) - IST_OFFSET_MS);
  } else {
    prevStart = new Date(start.getTime() - (end.getTime() - start.getTime()));
  }
  const prevEnd = new Date(Math.min(prevStart.getTime() + elapsed, start.getTime()));
  const label = range === "today" ? "vs same time yesterday" : range === "week" ? "vs same point last week" : "vs same point last month";
  return { start: prevStart, end: prevEnd, label };
}

export const isCallAfterHours = (c: CallRow) => isAfterHours(when(c));

// ---------------------------------------------------------------------------
// Service levels (gauges) and designer list, call-centre style.

export const HANDOFF_TARGET_S = 120; // brief: designer email within two minutes of the call ending
export const ACK_TARGET_S = 2 * 60 * 60; // escalation fires after two hours

export type Level = "good" | "warning" | "critical" | "none";

export interface ServiceLevel {
  key: string;
  label: string;
  /** 0–100, or null when there is nothing to measure yet. */
  percent: number | null;
  met: number;
  total: number;
  level: Level;
  detail: string;
}

function levelFor(percent: number | null, good: number, warn: number): Level {
  if (percent === null) return "none";
  return percent >= good ? "good" : percent >= warn ? "warning" : "critical";
}

const secondsBetween = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 1000;

export function serviceLevels(calls: CallRow[], handoffs: HandoffRow[]): ServiceLevel[] {
  const byId = new Map(calls.map((c) => [c.id, c]));
  const sent = handoffs.filter((h) => h.email_sent_at);

  const timed = sent.filter((h) => byId.get(h.call_id)?.ended_at);
  const fast = timed.filter((h) => secondsBetween(byId.get(h.call_id)!.ended_at!, h.email_sent_at!) <= HANDOFF_TARGET_S).length;

  const ackedInTime = sent.filter((h) => h.acknowledged_at && secondsBetween(h.email_sent_at!, h.acknowledged_at) <= ACK_TARGET_S).length;

  const qualified = calls.filter((c) => c.outcome === "qualified");
  const booked = qualified.filter((c) => c.booking_status === "booked").length;
  // A call back the caller chose is a handled next step too (the agent offers book-now or call-back).
  const callbacks = qualified.filter(
    (c) => c.booking_status !== "booked" && (c.classification as { callback_requested?: boolean } | null)?.callback_requested === true,
  ).length;

  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : null);
  const handoffPct = pct(fast, timed.length);
  const ackPct = pct(ackedInTime, sent.length);
  const bookedPct = pct(booked + callbacks, qualified.length);

  return [
    { key: "handoff", label: "Brief sent within 2 min", percent: handoffPct, met: fast, total: timed.length, level: levelFor(handoffPct, 90, 70), detail: `${fast} of ${timed.length} briefs` },
    { key: "ack", label: "Acknowledged within 2 h", percent: ackPct, met: ackedInTime, total: sent.length, level: levelFor(ackPct, 90, 70), detail: `${ackedInTime} of ${sent.length} leads` },
    {
      key: "booked",
      label: "Next step agreed on the call",
      percent: bookedPct,
      met: booked + callbacks,
      total: qualified.length,
      level: levelFor(bookedPct, 80, 60),
      detail: `${booked} booked · ${callbacks} call-back${callbacks === 1 ? "" : "s"} · ${qualified.length} qualified`,
    },
  ];
}

export interface DesignerStat {
  id: string;
  name: string;
  areas: string[];
  active: boolean;
  leads: number;
  booked: number;
  acknowledged: number;
  waiting: number;
  medianAckSeconds: number | null;
}

export function designerStats(
  designers: { id: string; name: string; areas: string[]; active: boolean }[],
  calls: CallRow[],
  handoffs: HandoffRow[],
): DesignerStat[] {
  const byCall = new Map(calls.map((c) => [c.id, c]));
  return designers
    .map((d) => {
      const mine = handoffs.filter((h) => h.designer_id === d.id && h.email_sent_at);
      const ackTimes = mine.filter((h) => h.acknowledged_at).map((h) => secondsBetween(h.email_sent_at!, h.acknowledged_at!)).sort((a, b) => a - b);
      const mid = Math.floor(ackTimes.length / 2);
      return {
        id: d.id,
        name: d.name,
        areas: d.areas,
        active: d.active,
        leads: mine.length,
        booked: mine.filter((h) => byCall.get(h.call_id)?.booking_status === "booked").length,
        acknowledged: ackTimes.length,
        waiting: mine.length - ackTimes.length,
        medianAckSeconds: ackTimes.length ? (ackTimes.length % 2 ? ackTimes[mid] : (ackTimes[mid - 1] + ackTimes[mid]) / 2) : null,
      };
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || b.leads - a.leads || a.name.localeCompare(b.name));
}

/** Calls and qualified leads per bucket, for the volume line chart. */
export function volumeSeries(buckets: Bucket[]) {
  return buckets.map((b) => ({ key: b.key, label: b.label, title: b.title, calls: b.total, qualified: b.counts.qualified }));
}
