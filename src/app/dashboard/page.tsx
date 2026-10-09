import Link from "next/link";
import type { StoredClassification } from "@/lib/classify/schema";
import {
  OUTCOME_GROUPS,
  OUTCOME_GROUP_LABEL,
  delta,
  funnel,
  hourOfDay,
  outcomeGroup,
  previousRange,
  timeBuckets,
  type Delta,
} from "@/lib/dashboard-data";
import { demoCallbacks, demoDesigners, demoPipeline, demoRange, isDemo } from "@/lib/demo";
import { computeMetrics, designerMap, loadCallbacks, loadPipeline, loadRange, type Stats } from "@/lib/metrics";
import { redactPrices } from "@/lib/price-guard";
import { requireSession } from "@/lib/require-session";
import { formatDuration, formatIst, isAfterHours, istRange, type RangeKey } from "@/lib/time";
import { markCalledBack } from "./actions";
import { BarList, Card, HourBars, Legend, Sparkline, SplitBar, StackedColumns, type SeriesDef } from "./charts";
import styles from "./dashboard.module.css";

export const metadata = { title: "Dashboard · Aangan Enquiries" };

// Private, always-fresh data behind a password: a blocking render is intended.
export const instant = false;

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

const GROUP_COLOR: Record<string, string> = {
  qualified: "var(--series-1)",
  declined: "var(--series-2)",
  needs_review: "var(--series-3)",
  other: "var(--series-4)",
};

const SERIES: SeriesDef[] = OUTCOME_GROUPS.map((g) => ({ key: g, label: OUTCOME_GROUP_LABEL[g], color: GROUP_COLOR[g] }));

const HANDOFF_TARGET_S = 120; // brief: designer email within two minutes of the call ending

function money(n: number | null, currency: string, digits = 2) {
  if (n == null) return "–";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
}

function pct(part: number, whole: number) {
  return whole ? `${Math.round((part / whole) * 100)}%` : "–";
}

function DeltaBadge({ d }: { d: Delta }) {
  if (d.change === null) return <span className={styles.deltaFlat}>new</span>;
  const rounded = Math.round(d.change * 100);
  if (rounded === 0) return <span className={styles.deltaFlat}>0%</span>;
  const good = rounded > 0 === d.upIsGood;
  return (
    <span className={good ? styles.deltaUp : styles.deltaDown}>
      {rounded > 0 ? "▲" : "▼"} {Math.abs(rounded)}%
    </span>
  );
}

function Kpi({ label, value, d, compare, sub, spark }: { label: string; value: string; d: Delta; compare: string; sub?: string; spark?: React.ReactNode }) {
  return (
    <div className={styles.kpi}>
      <div className={styles.kpiLabel}>{label}</div>
      <div className={styles.kpiValue}>{value}</div>
      <div className={styles.kpiMeta}>
        <DeltaBadge d={d} />
        <span>{compare}</span>
      </div>
      {sub ? <div className={styles.kpiMeta}>{sub}</div> : null}
      {spark}
    </div>
  );
}

function Health({ ok, warn, title, detail }: { ok: boolean; warn?: boolean; title: string; detail: string }) {
  const cls = ok ? styles.healthGood : warn ? styles.healthWarn : styles.healthBad;
  return (
    <div className={styles.healthItem}>
      <span className={`${styles.healthIcon} ${cls}`} aria-hidden>
        {ok ? "✓" : "!"}
      </span>
      <div className={styles.healthText}>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
    </div>
  );
}

function latencyStat(label: string, s: Stats, target?: number) {
  const overTarget = target != null && s.median != null && s.median > target;
  return (
    <div className={styles.stat}>
      <div className={styles.statLabel}>{label}</div>
      <div className={`${styles.statValue} ${overTarget ? styles.alert : ""}`}>{formatDuration(s.median)}</div>
      <div className={styles.statSub}>{s.count ? `median · slowest ${formatDuration(s.max)}` : "no data yet"}</div>
      {target != null ? <div className={styles.statSub}>target under {formatDuration(target)}</div> : null}
    </div>
  );
}

export default async function Dashboard({ searchParams }: PageProps<"/dashboard">) {
  await requireSession();
  const sp = await searchParams;
  const range: RangeKey = sp.range === "week" || sp.range === "month" ? sp.range : "today";
  const { start, end } = istRange(range);
  const prev = previousRange(range, start, end);

  const demo = isDemo();
  const [data, prevData, pipeline, callbacks, designers] = demo
    ? [demoRange(start, end), demoRange(prev.start, prev.end), demoPipeline(), demoCallbacks(), demoDesigners()]
    : await Promise.all([loadRange(start, end), loadRange(prev.start, prev.end), loadPipeline(), loadCallbacks(), designerMap()]);

  const m = computeMetrics(data);
  const p = computeMetrics(prevData);
  const cur = m.cost.currency;
  const buckets = timeBuckets(data.calls, range, start, end);
  const hours = hourOfDay(data.calls);
  const steps = funnel(data.calls, data.handoffs);
  const ackByCall = new Map(data.handoffs.map((h) => [h.call_id, h]));
  const qualified = m.outcomes.qualified ?? 0;
  const prevQualified = p.outcomes.qualified ?? 0;

  const sparkTitles = buckets.map((b) => b.title);
  const columns = buckets.map((b) => ({ key: b.key, label: b.label, title: b.title, values: b.counts, extra: b.booked ? `${b.booked} booked` : undefined }));
  const labelEvery = range === "today" ? 3 : buckets.length > 14 ? 5 : 1;

  return (
    <main className={styles.page}>
      {demo ? <p className={styles.demo}>Demo data: DASHBOARD_DEMO is on. Nothing here is real.</p> : null}

      <header className={styles.topbar}>
        <div>
          <div className={styles.eyebrow}>
            <span className={styles.liveDot} aria-hidden />
            Live · updated {formatIst(new Date())} IST
          </div>
          <h1 className={styles.h1}>Aangan enquiries</h1>
        </div>
        <nav className={styles.toggle} aria-label="Period">
          {RANGES.map((r) => (
            <Link key={r.key} href={`/dashboard?range=${r.key}`} aria-current={r.key === range ? "page" : undefined}>
              {r.label}
            </Link>
          ))}
        </nav>
      </header>

      <section className={styles.kpis} aria-label="Headline numbers">
        <Kpi
          label="Calls answered"
          value={String(m.total)}
          d={delta(m.total, p.total)}
          compare={prev.label}
          sub={`${pct(m.afterHours, m.total)} after hours · avg ${formatDuration(m.avgDurationSeconds)}`}
          spark={<Sparkline values={buckets.map((b) => b.total)} titles={sparkTitles} color="var(--series-1)" label="calls" />}
        />
        <Kpi
          label="Qualified leads"
          value={String(qualified)}
          d={delta(qualified, prevQualified)}
          compare={prev.label}
          sub={`${pct(qualified, m.total)} of calls`}
          spark={<Sparkline values={buckets.map((b) => b.counts.qualified)} titles={sparkTitles} color="var(--series-1)" label="qualified" />}
        />
        <Kpi
          label="Consultations booked"
          value={String(m.booked)}
          d={delta(m.booked, p.booked)}
          compare={prev.label}
          sub={m.bookingFailed ? `${m.bookingFailed} booking failure${m.bookingFailed === 1 ? "" : "s"}` : "no booking failures"}
          spark={<Sparkline values={buckets.map((b) => b.booked)} titles={sparkTitles} color="var(--series-1)" label="booked" />}
        />
        <Kpi
          label="Cost per qualified lead"
          value={money(m.cost.perQualified, cur)}
          d={delta(m.cost.perQualified, p.cost.perQualified, false)}
          compare={prev.label}
          sub={`${money(m.cost.total, cur)} total · ${money(m.cost.perCall, cur)} per call`}
        />
      </section>

      <section className={styles.health} aria-label="Health checks">
        <Health ok={m.complianceIncidents === 0} title={m.complianceIncidents ? `${m.complianceIncidents} compliance incident${m.complianceIncidents === 1 ? "" : "s"}` : "No price quoted"} detail="agent never mentions a price" />
        <Health ok={m.unacknowledged === 0} warn title={m.unacknowledged ? `${m.unacknowledged} lead${m.unacknowledged === 1 ? "" : "s"} not acknowledged` : "All leads acknowledged"} detail="designer tapped “I've got this”" />
        <Health ok={m.bookingFailed === 0} warn title={m.bookingFailed ? `${m.bookingFailed} booking failure${m.bookingFailed === 1 ? "" : "s"}` : "Bookings healthy"} detail="Cal.com during the call" />
        <Health ok={callbacks.length === 0} warn title={callbacks.length ? `${callbacks.length} dropped call${callbacks.length === 1 ? "" : "s"} to call back` : "No calls to return"} detail="last 30 days" />
      </section>

      <div className={styles.grid2}>
        <Card title="Calls over time" subtitle={range === "today" ? "by hour, IST" : "by day, IST"}>
          <Legend items={SERIES.map((s) => ({ color: s.color, label: s.label }))} />
          <StackedColumns data={columns} series={SERIES} labelEvery={labelEvery} />
        </Card>
        <Card title="Lead funnel" subtitle="from first ring to a designer owning it">
          <BarList items={steps.map((s) => ({ label: s.label, value: s.value, note: s.note }))} color="var(--series-1)" emptyText="No calls in this period." />
        </Card>
      </div>

      <div className={`${styles.grid2} ${styles.grid2even}`}>
        <Card title="When people call" subtitle={`${pct(m.afterHours, m.total)} outside the 10am–7pm front desk`}>
          <Legend
            items={[
              { color: "var(--series-1)", label: "Front desk hours" },
              { color: "var(--series-2)", label: "After hours" },
            ]}
          />
          <HourBars slots={hours} inColor="var(--series-1)" afterColor="var(--series-2)" />
        </Card>
        <div className={styles.stack}>
          <Card title="Speed to lead" subtitle="a lead answered within the hour converts 4× better">
            <div className={styles.statPair}>
              {latencyStat("Call end → designer email", m.handoffLatency, HANDOFF_TARGET_S)}
              {latencyStat("Email → designer acknowledged", m.ackLatency)}
            </div>
          </Card>
          <Card
            title="What it cost"
            subtitle={`${m.cost.vaaniMinutes.toFixed(1)} call minutes · ${(m.cost.geminiTokens.input + m.cost.geminiTokens.output).toLocaleString("en-IN")} tokens · ${m.cost.emailsSent} emails`}
          >
            <SplitBar
              parts={[
                { label: "Vaani calls", value: m.cost.vaani, display: money(m.cost.vaani, cur), color: "var(--series-1)" },
                { label: "Gemini", value: m.cost.gemini, display: money(m.cost.gemini, cur), color: "var(--series-2)" },
                { label: "Email", value: m.cost.email, display: money(m.cost.email, cur), color: "var(--series-3)" },
              ]}
            />
            {m.cost.missingRates.length ? <p className={styles.note}>Rate not set, counted as 0: {m.cost.missingRates.join(", ")}</p> : null}
          </Card>
        </div>
      </div>

      <div className={`${styles.grid2} ${styles.grid2even}`}>
        <Card title="Outcomes" subtitle="what the classifier decided">
          <BarList
            items={Object.entries(m.outcomes)
              .sort((a, b) => b[1] - a[1])
              .map(([k, v]) => ({ label: OUTCOME_LABEL[k] ?? k, value: v, note: pct(v, m.total), color: GROUP_COLOR[outcomeGroup(k)] }))}
            color="var(--series-1)"
          />
        </Card>
        <Card title="Decline reasons" subtitle="why a caller wasn't a fit">
          <BarList
            items={Object.entries(m.declineReasons)
              .sort((a, b) => b[1] - a[1])
              .map(([k, v]) => ({ label: k.replace(/_/g, " "), value: v, note: pct(v, m.outcomes.declined ?? 0) }))}
            color="var(--series-2)"
            emptyText="No declines in this period."
          />
        </Card>
      </div>

      <div className={styles.grid2}>
        <Card title="Recent calls" subtitle={`${data.calls.length} in this period`}>
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
                          <span className={styles.pill}>
                            <span className={styles.pillDot} style={{ background: GROUP_COLOR[outcomeGroup(c.outcome)] }} />
                            {c.outcome ? OUTCOME_LABEL[c.outcome] : c.status}
                          </span>
                          {c.decline_reason ? <span className={styles.muted}> {c.decline_reason.replace(/_/g, " ")}</span> : null}
                        </td>
                        <td>{c.designer_id ? (designers.get(c.designer_id)?.name ?? "–") : <span className={styles.muted}>–</span>}</td>
                        <td>{h ? h.acknowledged_at ? <span className={styles.ackYes}>✓ Yes</span> : <span className={styles.ackNo}>! No</span> : <span className={styles.muted}>–</span>}</td>
                        <td>
                          <Link href={`/dashboard/calls/${c.id}`}>Transcript →</Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={styles.note}>No calls in this period yet. They appear here as soon as the phone agent goes live.</p>
          )}
        </Card>
        <div className={styles.stack}>
          <Card title="Pipeline" subtitle={pipeline.lastSyncedAt ? `HubSpot · synced ${formatIst(pipeline.lastSyncedAt)}` : "HubSpot · not synced yet"}>
            <div className={styles.statPair}>
              <div className={styles.stat}>
                <div className={styles.statLabel}>Open deals</div>
                <div className={styles.statValue}>{pipeline.openDeals}</div>
              </div>
              <div className={styles.stat}>
                <div className={styles.statLabel}>Won deals</div>
                <div className={styles.statValue}>{pipeline.wonDeals}</div>
                <div className={styles.statSub}>{pipeline.wonValue == null ? "no value entered in HubSpot" : `${money(pipeline.wonValue, cur, 0)} entered in HubSpot`}</div>
              </div>
            </div>
          </Card>

          <Card title="Call back" subtitle="dropped calls with a number, last 30 days">
            {callbacks.length ? (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <tbody>
                    {callbacks.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <a href={`tel:${c.caller_phone}`}>{c.caller_phone}</a>
                          <div className={styles.muted}>{formatIst(c.started_at ?? c.created_at)}</div>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <form action={markCalledBack}>
                            <input type="hidden" name="id" value={c.id} />
                            <button className={styles.pill} type="submit" style={{ cursor: "pointer" }}>
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
          </Card>
        </div>
      </div>
    </main>
  );
}
