import Link from "next/link";
import type { ReactNode } from "react";
import type { StoredClassification } from "@/lib/classify/schema";
import {
  HANDOFF_TARGET_S,
  delta,
  designerStats,
  hourOfDay,
  outcomeGroup,
  previousRange,
  serviceLevels,
  timeBuckets,
  volumeSeries,
  type Delta,
} from "@/lib/dashboard-data";
import { demoCallbacks, demoDesigners, demoPipeline, demoRange, isDemo } from "@/lib/demo";
import { computeMetrics, designerMap, loadCallbacks, loadPipeline, loadRange } from "@/lib/metrics";
import { redactPrices } from "@/lib/price-guard";
import { requireSession } from "@/lib/require-session";
import { formatDuration, formatIst, isAfterHours, istRange, type RangeKey } from "@/lib/time";
import { markCalledBack } from "./actions";
import { BarList, HourBars, Legend, Sparkline } from "./charts";
import styles from "./dashboard.module.css";
import { Donut, Gauge, RingStat, VolumeChart } from "./widgets";

export const metadata = { title: "Dashboard · Aangan Enquiries" };

// Private, always-fresh data behind a password: a blocking render is intended.
export const instant = false;

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
];

/** Six outcomes, six validated categorical slots (fixed order, never cycled). */
const OUTCOMES = [
  { key: "qualified", label: "Qualified", color: "var(--series-1)" },
  { key: "declined", label: "Declined", color: "var(--series-2)" },
  { key: "needs_review", label: "Needs review", color: "var(--series-3)" },
  { key: "existing_client", label: "Existing client", color: "var(--series-4)" },
  { key: "not_a_lead", label: "Not a lead", color: "var(--series-5)" },
  { key: "dropped", label: "Dropped", color: "var(--series-6)" },
] as const;
const RECENT_ROWS = 10;
const OUTCOME_LABEL: Record<string, string> = Object.fromEntries(OUTCOMES.map((o) => [o.key, o.label]));
const OUTCOME_COLOR: Record<string, string> = Object.fromEntries(OUTCOMES.map((o) => [o.key, o.color]));

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

function Kpi({ label, value, d, compare, sub, spark }: { label: string; value: string; d: Delta; compare: string; sub?: string; spark?: ReactNode }) {
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

function Widget({ title, sub, meta, span, id, children }: { title: string; sub?: string; meta?: ReactNode; span: string; id?: string; children: ReactNode }) {
  return (
    <section id={id} className={`${styles.widget} ${span}`}>
      <header className={styles.widgetHead}>
        <div>
          <h2 className={styles.widgetTitle}>{title}</h2>
          {sub ? <p className={styles.widgetSub}>{sub}</p> : null}
        </div>
        {meta ? <div className={styles.widgetMeta}>{meta}</div> : null}
      </header>
      {children}
    </section>
  );
}

export default async function Dashboard({ searchParams }: PageProps<"/dashboard">) {
  await requireSession();
  const sp = await searchParams;
  const range: RangeKey = sp.range === "week" || sp.range === "month" ? sp.range : "today";
  const rangeLabel = RANGES.find((r) => r.key === range)!.label;
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
  const volume = volumeSeries(buckets);
  const hours = hourOfDay(data.calls);
  const levels = serviceLevels(data.calls, data.handoffs);
  const team = designerStats([...designers.values()], data.calls, data.handoffs);
  const ackByCall = new Map(data.handoffs.map((h) => [h.call_id, h]));
  const qualified = m.outcomes.qualified ?? 0;
  const sparkTitles = buckets.map((b) => b.title);
  const labelEvery = range === "today" ? 3 : buckets.length > 14 ? 5 : 1;
  const now = new Date();

  return (
    <>
      <div className={styles.appbar}>
        <div className={styles.appbarInner}>
          <Link href="/dashboard" className={styles.wordmark}>
            AANGAN
          </Link>
          <nav className={styles.tabs} aria-label="Sections">
            <a href="#overview" aria-current="page">
              Overview
            </a>
            <a href="#designers">Designers</a>
            <a href="#calls">Calls</a>
            <a href="#callback">Call back</a>
          </nav>
          <div className={styles.appbarRight}>
            <div>
              <strong>{formatIst(now)}</strong>
              India Standard Time
            </div>
            <span className={styles.avatar} title="Aangan Studio">
              AS
            </span>
          </div>
        </div>
      </div>

      <main className={styles.shell} id="overview">
        {demo ? <p className={styles.demo}>Demo data: DASHBOARD_DEMO is on. Nothing here is real.</p> : null}

        <div className={styles.pageHead}>
          <div>
            <h1 className={styles.pageTitle}>Enquiries dashboard</h1>
            <p className={styles.pageSub}>Every call answered by the voice agent, qualified, booked and handed to a designer.</p>
          </div>
          <nav className={styles.toggle} aria-label="Period">
            {RANGES.map((r) => (
              <Link key={r.key} href={`/dashboard?range=${r.key}`} aria-current={r.key === range ? "page" : undefined}>
                {r.label}
              </Link>
            ))}
          </nav>
        </div>

        <section className={styles.kpis} aria-label="Headline numbers" style={{ marginBottom: 16 }}>
          <Kpi
            label="Calls answered"
            value={String(m.total)}
            d={delta(m.total, p.total)}
            compare={prev.label}
            spark={<Sparkline values={buckets.map((b) => b.total)} titles={sparkTitles} color="var(--series-1)" label="calls" />}
          />
          <Kpi
            label="Qualified leads"
            value={String(qualified)}
            d={delta(qualified, p.outcomes.qualified ?? 0)}
            compare={prev.label}
            spark={<Sparkline values={buckets.map((b) => b.counts.qualified)} titles={sparkTitles} color="var(--series-1)" label="qualified" />}
          />
          <Kpi
            label="Consultations booked"
            value={String(m.booked)}
            d={delta(m.booked, p.booked)}
            compare={prev.label}
            spark={<Sparkline values={buckets.map((b) => b.booked)} titles={sparkTitles} color="var(--series-1)" label="booked" />}
          />
          <Kpi label="Cost per qualified lead" value={money(m.cost.perQualified, cur)} d={delta(m.cost.perQualified, p.cost.perQualified, false)} compare={prev.label} sub={`${money(m.cost.total, cur)} total`} />
        </section>

        <div className={styles.widgets}>
          <Widget title="Call disposition" sub={`${rangeLabel} · ${pct(qualified, m.total)} qualified`} span={styles.span5}>
            <Donut items={OUTCOMES.map((o) => ({ key: o.key, label: o.label, color: o.color, value: m.outcomes[o.key] ?? 0 }))} totalLabel="Total calls" />
          </Widget>

          <Widget title="Call volume" sub={range === "today" ? "By hour, IST" : "By day, IST"} span={styles.span7}>
            <Legend
              items={[
                { color: "var(--series-1)", label: "Calls answered" },
                { color: "var(--series-2)", label: "Qualified" },
              ]}
            />
            <VolumeChart data={volume} labelEvery={labelEvery} />
          </Widget>

          <Widget title="Service level" sub="Speed to lead: answered within the hour converts 4× better" span={styles.span12}>
            <div className={styles.gauges}>
              {levels.map((l) => (
                <Gauge
                  key={l.key}
                  label={l.label}
                  percent={l.percent}
                  level={l.level}
                  detail={l.detail}
                  footnote={
                    l.key === "handoff"
                      ? `median ${formatDuration(m.handoffLatency.median)} · target ${formatDuration(HANDOFF_TARGET_S)}`
                      : l.key === "ack"
                        ? `median ${formatDuration(m.ackLatency.median)} · ${m.unacknowledged} waiting`
                        : `${m.bookingFailed} booking failure${m.bookingFailed === 1 ? "" : "s"}`
                  }
                />
              ))}
            </div>
          </Widget>

          <Widget title="Enquiry status" sub={`${rangeLabel} · ${prev.label.replace("vs ", "compared ")}`} span={styles.span8} meta={m.cost.missingRates.length ? "cost rates not set" : undefined}>
            <div className={styles.statusTop}>
              <RingStat label="Average call length" value={formatDuration(m.avgDurationSeconds)} />
              <RingStat label="Calls outside 10am–7pm" value={pct(m.afterHours, m.total)} />
              <dl className={styles.kvList}>
                <dt>Calls answered</dt>
                <dd>{m.total}</dd>
                <dt>Qualified</dt>
                <dd>{qualified}</dd>
                <dt>Asked about pricing</dt>
                <dd>{m.pricingRequested}</dd>
                <dt>Agent quoted a price</dt>
                <dd className={m.complianceIncidents ? styles.alert : styles.ok}>{m.complianceIncidents ? `! ${m.complianceIncidents} incident${m.complianceIncidents === 1 ? "" : "s"}` : "✓ never"}</dd>
              </dl>
            </div>
            <div className={styles.cells}>
              <div className={styles.cell}>
                <div className={styles.cellLabel}>Total cost</div>
                <div className={styles.cellValue}>{money(m.cost.total, cur)}</div>
              </div>
              <div className={styles.cell}>
                <div className={styles.cellLabel}>Cost per call</div>
                <div className={styles.cellValue}>{money(m.cost.perCall, cur)}</div>
              </div>
              <div className={styles.cell}>
                <div className={styles.cellLabel}>Call minutes</div>
                <div className={styles.cellValue}>{m.cost.vaaniMinutes.toFixed(1)}</div>
              </div>
              <div className={styles.cell}>
                <div className={styles.cellLabel}>Emails sent</div>
                <div className={styles.cellValue}>{m.cost.emailsSent}</div>
              </div>
            </div>
          </Widget>

          <Widget title="Decline reasons" sub={`${m.outcomes.declined ?? 0} declined`} span={styles.span4}>
            <BarList
              items={Object.entries(m.declineReasons)
                .sort((a, b) => b[1] - a[1])
                .map(([k, v]) => ({ label: k.replace(/_/g, " "), value: v, note: pct(v, m.outcomes.declined ?? 0) }))}
              color="var(--series-2)"
              emptyText="No declines in this period."
            />
          </Widget>

          <Widget title="When people call" sub={`${pct(m.afterHours, m.total)} outside front desk hours`} span={styles.span7}>
            <Legend
              items={[
                { color: "var(--series-1)", label: "Front desk (10am–7pm)" },
                { color: "var(--series-2)", label: "After hours" },
              ]}
            />
            <HourBars slots={hours} inColor="var(--series-1)" afterColor="var(--series-2)" />
          </Widget>

          <Widget title="Pipeline" sub="HubSpot" span={styles.span5} meta={pipeline.lastSyncedAt ? `synced ${formatIst(pipeline.lastSyncedAt)}` : "not synced yet"}>
            <div className={styles.statusTop} style={{ gridTemplateColumns: "auto auto" }}>
              <RingStat label="Open deals" value={String(pipeline.openDeals)} />
              <RingStat label="Won deals" value={String(pipeline.wonDeals)} tone="good" />
            </div>
            <p className={styles.note} style={{ marginTop: 14 }}>
              {pipeline.wonValue == null ? "Won value appears once someone enters it on a won deal in HubSpot." : `Won value entered in HubSpot: ${money(pipeline.wonValue, cur, 0)}`}
            </p>
          </Widget>

          <Widget title="Designer list" sub={`${team.filter((t) => t.active).length} active designers`} span={styles.span12} id="designers">
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Designer</th>
                    <th>Status</th>
                    <th>Areas</th>
                    <th className={styles.num}>Leads</th>
                    <th className={styles.num}>Booked</th>
                    <th className={styles.num}>Acknowledged</th>
                    <th className={styles.num}>Waiting</th>
                    <th className={styles.num}>Median ack</th>
                  </tr>
                </thead>
                <tbody>
                  {team.map((t) => (
                    <tr key={t.id}>
                      <td style={{ fontWeight: 500 }}>{t.name}</td>
                      <td>
                        <span className={styles.statusDot} style={{ background: t.active ? "var(--good)" : "var(--axis)" }} />
                        {t.active ? "Active" : "Inactive"}
                      </td>
                      <td>
                        <div className={styles.areas} title={t.areas.join(", ")}>
                          {t.areas.join(", ") || "–"}
                        </div>
                      </td>
                      <td className={styles.num}>{t.leads}</td>
                      <td className={styles.num}>{t.booked}</td>
                      <td className={styles.num}>{t.acknowledged}</td>
                      <td className={styles.num}>{t.waiting ? <span className={styles.ackNo}>{t.waiting}</span> : 0}</td>
                      <td className={styles.num}>{formatDuration(t.medianAckSeconds)}</td>
                    </tr>
                  ))}
                  <tr className={styles.tableTotal}>
                    <td>Total</td>
                    <td />
                    <td />
                    <td className={styles.num}>{team.reduce((s, t) => s + t.leads, 0)}</td>
                    <td className={styles.num}>{team.reduce((s, t) => s + t.booked, 0)}</td>
                    <td className={styles.num}>{team.reduce((s, t) => s + t.acknowledged, 0)}</td>
                    <td className={styles.num}>{team.reduce((s, t) => s + t.waiting, 0)}</td>
                    <td className={styles.num}>{formatDuration(m.ackLatency.median)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Widget>

          <Widget title="Recent calls" sub={`Latest ${Math.min(RECENT_ROWS, data.calls.length)} of ${data.calls.length} in ${rangeLabel.toLowerCase()}`} span={styles.span8} id="calls">
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
                    {data.calls.slice(0, RECENT_ROWS).map((c) => {
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
                              <span className={styles.pillDot} style={{ background: c.outcome ? OUTCOME_COLOR[c.outcome] : "var(--axis)" }} />
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
          </Widget>

          <Widget title="Call back" sub="Dropped calls with a number, last 30 days" span={styles.span4} id="callback">
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
          </Widget>
        </div>
      </main>
    </>
  );
}
