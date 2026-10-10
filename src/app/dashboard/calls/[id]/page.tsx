import Link from "next/link";
import { notFound } from "next/navigation";
import type { StoredClassification } from "@/lib/classify/schema";
import { sql, sqlOne } from "@/lib/db";
import { demoCall, demoDesigners, demoHandoff, isDemo } from "@/lib/demo";
import { getDesigner } from "@/lib/designers";
import { isDashboardPublic } from "@/lib/auth";
import { maskPhones, redactForDisplay } from "@/lib/price-guard";
import { requireSession } from "@/lib/require-session";
import { formatDuration, formatIst } from "@/lib/time";
import type { CallRow } from "@/lib/types";
import styles from "../../dashboard.module.css";

export const metadata = { title: "Call · Aangan Enquiries" };

// Private, always-fresh data behind a password: a blocking render is intended.
export const instant = false;

function SimResult(p: {
  scenarioId: string | null;
  expected: string | null;
  expectedReason: string | null;
  outcome: string | null;
  reason: string | null;
  priceByAgent: boolean;
  violations: string[];
  error: string | null;
}) {
  const outcomeOk = p.expected ? p.outcome === p.expected : null;
  const reasonOk = p.expectedReason ? p.reason === p.expectedReason : null;
  const pass = outcomeOk !== false && reasonOk !== false && !p.error;
  return (
    <div className={styles.widget} style={{ margin: "12px 0", borderColor: p.expected ? (pass ? "var(--good)" : "var(--critical)") : undefined }}>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>Free test run{p.scenarioId ? ` · case ${p.scenarioId}` : " · pasted transcript"} · no Vaani minutes used</div>
      {p.expected ? (
        <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }} className={pass ? styles.ok : styles.alert}>
          {pass ? "✓ Pass" : "! Mismatch"}: expected {p.expected}
          {p.expectedReason ? ` (${p.expectedReason})` : ""}, got {p.outcome ?? "nothing"}
          {p.reason ? ` (${p.reason})` : ""}
        </div>
      ) : (
        <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>Result: {p.outcome ?? "not classified"}{p.reason ? ` (${p.reason})` : ""}</div>
      )}
      <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 4 }}>
        Agent quoted a price: {p.priceByAgent ? "YES, compliance incident raised" : "no"} · Agent rule breaks: {p.violations.length ? p.violations.join(", ").replace(/_/g, " ") : "none"}
      </div>
      <div style={{ marginTop: 8 }}>
        <Link href="/dashboard/test" className={styles.back}>
          ← Run another test call
        </Link>
      </div>
    </div>
  );
}

export default async function CallPage({ params, searchParams }: PageProps<"/dashboard/calls/[id]">) {
  await requireSession();
  const { id } = await params;
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : null);
  const expected = one(sp.expected);
  const expectedReason = one(sp.reason);
  const scenarioId = one(sp.scenario);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const demo = isDemo();
  const call = demo ? demoCall(id) : await sqlOne<CallRow>`select * from calls where id = ${id}`;
  if (!call) notFound();
  type Handoff = { email_sent_at: string | null; acknowledged_at: string | null; escalated_at: string | null };
  const [designer, h, incidents] = demo
    ? [call.designer_id ? demoDesigners().get(call.designer_id) ?? null : null, demoHandoff(id) as Handoff | null, [] as { type: string }[]]
    : await Promise.all([
        call.designer_id ? getDesigner(call.designer_id) : null,
        sqlOne<Handoff>`select email_sent_at, acknowledged_at, escalated_at from handoffs where call_id = ${id}`,
        sql<{ type: string }>`select type from incidents where call_id = ${id}`,
      ]);
  const c = call.classification as StoredClassification | null;
  const r = (s: string | null | undefined) => (s ? (isDashboardPublic() ? maskPhones(redactForDisplay(s)) : redactForDisplay(s)) : "–");

  const rows: [string, React.ReactNode][] = [
    ["When", formatIst(call.started_at ?? call.created_at, { withYear: true })],
    ["Duration", formatDuration(call.duration_seconds)],
    ["Caller number", call.caller_phone ? (isDashboardPublic() ? maskPhones(call.caller_phone) : <a href={`tel:${call.caller_phone}`}>{call.caller_phone}</a>) : "–"],
    ["Outcome", c ? `${c.outcome}${c.decline_reason ? ` (${c.decline_reason})` : ""}` : call.status],
    ...(c?.review_reason ? ([["Why review", r(c.review_reason)]] as [string, React.ReactNode][]) : []),
    ["Confidence", c ? c.confidence.toFixed(2) : "–"],
    ["Designer", designer?.name ?? "–"],
    ["Booking", call.booking_status === "booked" && call.booking_start ? `${formatIst(call.booking_start)} (${call.consultation_mode ?? "venue not set"})` : call.booking_status.replace("_", " ")],
    ["Handoff email", h?.email_sent_at ? formatIst(h.email_sent_at) : "–"],
    ["Acknowledged", h?.acknowledged_at ? formatIst(h.acknowledged_at) : h?.escalated_at ? `No (escalated ${formatIst(h.escalated_at)})` : "No"],
  ];
  if (c) {
    const f = c.fields;
    rows.push(
      ["Name", r(f.name)],
      ["Location", r(f.location)],
      ["Property", `${r(f.property_type)}${f.carpet_area_sqft ? `, ${f.carpet_area_sqft} sq ft` : ""}`],
      ["Scope", r(f.scope)],
      ["Current state", r(f.current_state)],
      ["Needed by", r(f.needed_by)],
      ["Decision-maker", `${r(f.decision_maker)} (${f.decision_maker_confirmed ? "confirmed" : "not confirmed"})`],
      ["Budget", f.budget_volunteered ? "Mentioned by caller (amount withheld)" : "Not discussed"],
      ["Source", r(f.source)],
      ["Asked about pricing", c.pricing_requested ? "Yes" : "No"],
      ["Agent mentioned a price", c.price_mentioned_by_agent ? "YES (compliance incident)" : "No"],
      ["Agent rule breaks", c.agent_violations?.length ? c.agent_violations.map((v) => v.replace(/_/g, " ")).join(", ") : "None"],
      ["Flags", c.flags.length ? c.flags.map(r).join(" · ") : "–"],
    );
  }

  return (
    <main className={styles.page}>
      {demo ? <p className={styles.demo}>Demo data: DASHBOARD_DEMO is on. Nothing here is real.</p> : null}
      <Link href="/dashboard" className={styles.back}>
        ← Dashboard
      </Link>
      {call.provider === "simulator" ? (
        <SimResult
          scenarioId={scenarioId}
          expected={expected}
          expectedReason={expectedReason}
          outcome={c?.outcome ?? null}
          reason={c?.decline_reason ?? null}
          priceByAgent={c?.price_mentioned_by_agent ?? false}
          violations={c?.agent_violations ?? []}
          error={call.processing_error}
        />
      ) : null}
      <h1 className={styles.h1} style={{ marginTop: 10 }}>
        {c?.fields.name ? r(c.fields.name) : "Call"}
      </h1>
      {c?.caller_quote ? <p style={{ fontStyle: "italic", fontSize: 17 }}>“{r(c.caller_quote)}”</p> : null}
      {incidents.length ? <p className={styles.error}>Incidents: {incidents.map((i) => i.type).join(", ")}</p> : null}
      {call.processing_error ? <p className={styles.error}>Processing error: {call.processing_error}</p> : null}

      <h2 className={styles.h2}>Details</h2>
      <div className={`${styles.card} ${styles.kv}`}>
        {rows.flatMap(([k, v]) => [<div key={`${k}-k`}>{k}</div>, <div key={`${k}-v`}>{v}</div>])}
      </div>

      <h2 className={styles.h2}>Transcript</h2>
      <p className={styles.muted}>Money amounts are hidden on this page.</p>
      <div className={`${styles.card} ${styles.transcript}`}>
        {(call.transcript ?? []).length ? (
          call.transcript!.map((t, i) => (
            <div key={i} className={`${styles.turn} ${t.role === "agent" ? styles.agent : styles.caller}`}>
              {isDashboardPublic() ? maskPhones(redactForDisplay(t.text)) : redactForDisplay(t.text)}
            </div>
          ))
        ) : (
          <p className={styles.note}>No transcript stored.</p>
        )}
      </div>
    </main>
  );
}
