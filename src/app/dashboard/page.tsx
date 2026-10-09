import Link from "next/link";
import { computeMetrics, designerMap, loadCallbacks, loadPipeline, loadRange, type Stats } from "@/lib/metrics";
import { redactPrices } from "@/lib/price-guard";
import { requireSession } from "@/lib/require-session";
import { formatDuration, formatIst, istRange, isAfterHours, type RangeKey } from "@/lib/time";
import type { StoredClassification } from "@/lib/classify/schema";
import { markCalledBack } from "./actions";
import styles from "./dashboard.module.css";

export const metadata = { title: "Dashboard · Aangan Enquiries" };

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
];

const OUTCOME_LABEL: Record<string, string> = {
  qualified: "Qualified",
  declined: "Declined",
  needs_review: "Needs review",
  existing_client: "Existing client",
  not_a_lead: "Not a lead",
  dropped: "Dropped",
};

function money(n: number | null, currency: string, digits = 2) {
  if (n == null) return "–";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
}

function pct(part: number, whole: number) {
  return whole ? `${Math.round((part / whole) * 100)}%` : "–";
}

function Tile({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "alert" | "ok" }) {
  return (
    <div className={styles.tile}>
      <div className={styles.tileLabel}>{label}</div>
      <div className={`${styles.tileValue} ${tone ? styles[tone] : ""}`}>{value}</div>
      {sub ? <div className={styles.tileSub}>{sub}</div> : null}
    </div>
  );
}

function latency(s: Stats) {
  return s.count ? `median ${formatDuration(s.median)} · slowest ${formatDuration(s.max)}` : "no data yet";
}

function Bars({ data, labels }: { data: Record<string, number>; labels?: Record<string, string> }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return <p className={styles.note}>Nothing in this period.</p>;
  const max = Math.max(...entries.map(([, v]) => v));
  return (
    <ul className={styles.bars}>
      {entries.map(([k, v]) => (
        <li key={k}>
          <span>{labels?.[k] ?? k.replace(/_/g, " ")}</span>
          <span className={styles.bar} style={{ width: `${(v / max) * 100}%` }} />
          <span className={styles.num}>{v}</span>
        </li>
      ))}
    </ul>
  );
}

export default async function Dashboard({ searchParams }: PageProps<"/dashboard">) {
  await requireSession();
  const sp = await searchParams;
  const range: RangeKey = sp.range === "week" || sp.range === "month" ? sp.range : "today";
  const { start, end } = istRange(range);

  const [data, pipeline, callbacks, designers] = await Promise.all([loadRange(start, end), loadPipeline(), loadCallbacks(), designerMap()]);
  const m = computeMetrics(data);
  const ackByCall = new Map(data.handoffs.map((h) => [h.call_id, h]));
  const cur = m.cost.currency;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.h1}>Aangan enquiries</h1>
        <nav className={styles.toggle} aria-label="Period">
          {RANGES.map((r) => (
            <Link key={r.key} href={`/dashboard?range=${r.key}`} aria-current={r.key === range ? "page" : undefined}>
              {r.label}
            </Link>
          ))}
        </nav>
      </header>

      <h2 className={styles.h2}>Calls</h2>
      <div className={styles.grid}>
        <Tile label="Calls answered" value={m.total} sub={m.pendingClassification ? `${m.pendingClassification} still processing` : undefined} />
        <Tile label="After hours" value={pct(m.afterHours, m.total)} sub={`${m.afterHours} outside 10am–7pm`} />
        <Tile label="Average call" value={formatDuration(m.avgDurationSeconds)} />
        <Tile label="Qualified" value={m.outcomes.qualified ?? 0} sub={pct(m.outcomes.qualified ?? 0, m.total)} />
        <Tile label="Consultations booked" value={m.booked} />
        <Tile label="Booking failures" value={m.bookingFailed} tone={m.bookingFailed ? "alert" : undefined} />
        <Tile label="Asked about pricing" value={m.pricingRequested} />
        <Tile label="Compliance incidents" value={m.complianceIncidents} tone={m.complianceIncidents ? "alert" : "ok"} sub="should be zero" />
      </div>

      <h2 className={styles.h2}>Outcomes</h2>
      <div className={styles.card}>
        <Bars data={m.outcomes} labels={OUTCOME_LABEL} />
      </div>
      <h2 className={styles.h2}>Decline reasons</h2>
      <div className={styles.card}>
        <Bars data={m.declineReasons} />
      </div>

      <h2 className={styles.h2}>Speed</h2>
      <div className={styles.grid}>
        <Tile label="Call end → designer email" value={formatDuration(m.handoffLatency.median)} sub={latency(m.handoffLatency)} />
        <Tile label="Email → designer acknowledged" value={formatDuration(m.ackLatency.median)} sub={latency(m.ackLatency)} />
        <Tile label="Not yet acknowledged" value={m.unacknowledged} tone={m.unacknowledged ? "alert" : undefined} />
      </div>

      <h2 className={styles.h2}>Cost</h2>
      <div className={styles.grid}>
        <Tile label="Total" value={money(m.cost.total, cur)} sub={`Vaani ${money(m.cost.vaani, cur)} · Gemini ${money(m.cost.gemini, cur)} · Email ${money(m.cost.email, cur)}`} />
        <Tile label="Per call" value={money(m.cost.perCall, cur)} />
        <Tile label="Per qualified lead" value={money(m.cost.perQualified, cur)} />
        <Tile
          label="Usage"
          value={`${m.cost.vaaniMinutes.toFixed(1)} min`}
          sub={`${(m.cost.geminiTokens.input + m.cost.geminiTokens.output).toLocaleString("en-IN")} tokens · ${m.cost.emailsSent} emails`}
        />
      </div>
      {m.cost.missingRates.length ? <p className={styles.note}>Rate not set (counted as 0): {m.cost.missingRates.join(", ")}</p> : null}

      <h2 className={styles.h2}>Pipeline (HubSpot)</h2>
      <div className={styles.grid}>
        <Tile label="Open deals" value={pipeline.openDeals} />
        <Tile label="Won deals" value={pipeline.wonDeals} />
        <Tile label="Won value (entered in HubSpot)" value={pipeline.wonValue == null ? "–" : money(pipeline.wonValue, cur, 0)} sub={pipeline.lastSyncedAt ? `synced ${formatIst(pipeline.lastSyncedAt)}` : "not synced yet"} />
      </div>

      <h2 className={styles.h2}>Dropped calls to call back</h2>
      <div className={styles.card}>
        {callbacks.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <tbody>
                {callbacks.map((c) => (
                  <tr key={c.id}>
                    <td>{formatIst(c.started_at ?? c.created_at)}</td>
                    <td>
                      <a href={`tel:${c.caller_phone}`}>{c.caller_phone}</a>
                    </td>
                    <td>
                      <Link href={`/dashboard/calls/${c.id}`}>Transcript</Link>
                    </td>
                    <td>
                      <form action={markCalledBack}>
                        <input type="hidden" name="id" value={c.id} />
                        <button className={styles.pill} type="submit" style={{ border: 0, cursor: "pointer" }}>
                          Called back ✓
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={styles.note}>None waiting.</p>
        )}
      </div>

      <h2 className={styles.h2}>Recent calls</h2>
      <div className={styles.card}>
        {data.calls.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Caller</th>
                  <th>Outcome</th>
                  <th>Designer</th>
                  <th>Ack</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.calls.slice(0, 50).map((c) => {
                  const h = ackByCall.get(c.id);
                  const name = (c.classification as StoredClassification | null)?.fields?.name;
                  const when = c.started_at ?? c.created_at;
                  return (
                    <tr key={c.id}>
                      <td>
                        {formatIst(when)}
                        {isAfterHours(new Date(when)) ? <span className={styles.muted}> · after hours</span> : null}
                      </td>
                      <td>{name ? redactPrices(name) : <span className={styles.muted}>–</span>}</td>
                      <td>
                        <span className={styles.pill}>{c.outcome ? OUTCOME_LABEL[c.outcome] : c.status}</span>
                        {c.decline_reason ? <span className={styles.muted}> {c.decline_reason.replace(/_/g, " ")}</span> : null}
                      </td>
                      <td>{c.designer_id ? designers.get(c.designer_id)?.name ?? "–" : "–"}</td>
                      <td>{h ? (h.acknowledged_at ? "Yes" : "No") : "–"}</td>
                      <td>
                        <Link href={`/dashboard/calls/${c.id}`}>Transcript</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={styles.note}>No calls in this period.</p>
        )}
      </div>
    </main>
  );
}
