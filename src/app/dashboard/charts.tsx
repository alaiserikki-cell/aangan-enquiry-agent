"use client";

// Small, dependency-free SVG charts for the dashboard.
// Rules followed (dataviz skill): one y-axis, thin marks, 2px surface gaps, rounded data
// ends, legend for >=2 series, hover + keyboard-focus tooltips with value first, hit
// targets larger than the mark, text in ink tokens (never the series colour).

import { useRef, useState, type ReactNode } from "react";
import styles from "./dashboard.module.css";

type TipRow = { color?: string; label: string; value: string };
type Tip = { x: number; y: number; title: string; rows: TipRow[] } | null;

function useTooltip() {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip>(null);
  const show = (e: { clientX: number; clientY: number } | DOMRect, title: string, rows: TipRow[]) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const cx = "clientX" in e ? e.clientX : e.left + e.width / 2;
    const cy = "clientY" in e ? e.clientY : e.top;
    // Keep the tooltip inside the chart horizontally (measured here, in the event, not in render).
    const x = Math.min(Math.max(cx - box.left, 70), Math.max(70, box.width - 70));
    setTip({ x, y: cy - box.top, title, rows });
  };
  const hide = () => setTip(null);
  const node = tip ? (
    <div className={styles.tooltip} role="status" style={{ left: tip.x, top: tip.y }}>
      <div className={styles.tooltipTitle}>{tip.title}</div>
      {tip.rows.map((r) => (
        <div key={r.label} className={styles.tooltipRow}>
          {r.color ? <span className={styles.tooltipKey} style={{ background: r.color }} /> : null}
          <strong>{r.value}</strong>
          <span>{r.label}</span>
        </div>
      ))}
    </div>
  ) : null;
  return { ref, show, hide, node };
}

export function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <ul className={styles.legend}>
      {items.map((i) => (
        <li key={i.label}>
          <span className={styles.legendSwatch} style={{ background: i.color }} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/** Rounded-top rect path anchored to the baseline. */
function topRounded(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h);
  if (h <= 0) return "";
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

function niceMax(n: number) {
  if (n <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(n));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * pow).find((s) => s * 4 >= n)!;
  return step * 4;
}

// ---------------------------------------------------------------------------

export interface SeriesDef {
  key: string;
  label: string;
  color: string;
}

export interface ColumnDatum {
  key: string;
  label: string;
  title: string;
  values: Record<string, number>;
  extra?: string;
}

/** Stacked columns over time (calls per day / hour by outcome). */
export function StackedColumns({ data, series, height = 220, labelEvery = 1 }: { data: ColumnDatum[]; series: SeriesDef[]; height?: number; labelEvery?: number }) {
  const { ref: tipRef, show: tipShow, hide: tipHide, node: tipNode } = useTooltip();
  const W = 640;
  const H = height;
  const pad = { l: 28, r: 6, t: 8, b: 22 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const totals = data.map((d) => series.reduce((s, sr) => s + (d.values[sr.key] ?? 0), 0));
  const max = niceMax(Math.max(1, ...totals));
  const slot = plotW / Math.max(1, data.length);
  const barW = Math.max(3, Math.min(28, slot * 0.62));
  const ticks = [0, max / 2, max];
  const y = (v: number) => pad.t + plotH - (v / max) * plotH;

  return (
    <div ref={tipRef} className={styles.chartWrap}>
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.chartSvg} role="img" aria-label="Calls over time by outcome">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className={t === 0 ? styles.baseline : styles.gridline} />
            <text x={pad.l - 6} y={y(t)} dy="0.32em" textAnchor="end" className={styles.axisText}>
              {Number.isInteger(t) ? t : t.toFixed(1)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = pad.l + i * slot + (slot - barW) / 2;
          let acc = 0;
          const segs = series
            .map((s) => ({ s, v: d.values[s.key] ?? 0 }))
            .filter((p) => p.v > 0);
          const total = totals[i];
          const rows = series.map((s) => ({ color: s.color, label: s.label, value: String(d.values[s.key] ?? 0) }));
          const label = `${d.title}: ${total} call${total === 1 ? "" : "s"}`;
          return (
            <g
              key={d.key}
              tabIndex={0}
              aria-label={label}
              className={styles.hitGroup}
              onPointerMove={(e) => tipShow(e, d.title, [{ label: "total calls", value: String(total) }, ...rows, ...(d.extra ? [{ label: d.extra, value: "" }] : [])])}
              onPointerLeave={tipHide}
              onFocus={(e) => tipShow(e.currentTarget.getBoundingClientRect(), d.title, [{ label: "total calls", value: String(total) }, ...rows])}
              onBlur={tipHide}
            >
              <rect x={pad.l + i * slot} y={pad.t} width={slot} height={plotH} fill="transparent" />
              {segs.map(({ s, v }, j) => {
                const h = (v / max) * plotH;
                const top = y(acc + v);
                acc += v;
                const gap = j > 0 ? 2 : 0; // 2px surface gap between stacked segments
                const isTop = j === segs.length - 1;
                return isTop ? (
                  <path key={s.key} d={topRounded(x, top, barW, Math.max(0, h - gap), 4)} fill={s.color} className={styles.mark} />
                ) : (
                  <rect key={s.key} x={x} y={top} width={barW} height={Math.max(0, h - gap)} fill={s.color} className={styles.mark} />
                );
              })}
              {i % labelEvery === 0 ? (
                <text x={pad.l + i * slot + slot / 2} y={H - 6} textAnchor="middle" className={styles.axisText}>
                  {d.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {tipNode}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** 24 hourly bars; colour separates front-desk hours from after-hours. */
export function HourBars({ slots, inColor, afterColor }: { slots: { label: string; afterHours: boolean; count: number }[]; inColor: string; afterColor: string }) {
  const { ref: tipRef, show: tipShow, hide: tipHide, node: tipNode } = useTooltip();
  const W = 640;
  const H = 210;
  const pad = { l: 6, r: 6, t: 8, b: 20 };
  const plotH = H - pad.t - pad.b;
  const slot = (W - pad.l - pad.r) / 24;
  const barW = slot - 4;
  const max = Math.max(1, ...slots.map((s) => s.count));
  return (
    <div ref={tipRef} className={styles.chartWrap}>
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.chartSvg} role="img" aria-label="Calls by hour of day">
        <line x1={pad.l} x2={W - pad.r} y1={pad.t + plotH} y2={pad.t + plotH} className={styles.baseline} />
        {slots.map((s, i) => {
          const h = (s.count / max) * plotH;
          const x = pad.l + i * slot + 2;
          const title = `${s.label.replace("a", " am").replace("p", " pm")} · ${s.afterHours ? "after hours" : "front desk open"}`;
          return (
            <g
              key={s.label}
              tabIndex={0}
              aria-label={`${title}: ${s.count} calls`}
              className={styles.hitGroup}
              onPointerMove={(e) => tipShow(e, title, [{ color: s.afterHours ? afterColor : inColor, label: "calls", value: String(s.count) }])}
              onPointerLeave={tipHide}
              onFocus={(e) => tipShow(e.currentTarget.getBoundingClientRect(), title, [{ label: "calls", value: String(s.count) }])}
              onBlur={tipHide}
            >
              <rect x={pad.l + i * slot} y={pad.t} width={slot} height={plotH} fill="transparent" />
              {s.count > 0 ? <path d={topRounded(x, pad.t + plotH - h, barW, h, 3)} fill={s.afterHours ? afterColor : inColor} className={styles.mark} /> : null}
              {i % 3 === 0 ? (
                <text x={x + barW / 2} y={H - 5} textAnchor="middle" className={styles.axisText}>
                  {s.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {tipNode}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Tiny trend line for KPI tiles; hover shows the bucket value. */
export function Sparkline({ values, titles, color, label }: { values: number[]; titles: string[]; color: string; label: string }) {
  const { ref: tipRef, show: tipShow, hide: tipHide, node: tipNode } = useTooltip();
  const [hover, setHover] = useState<number | null>(null);
  const W = 120;
  const H = 32;
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const step = W / (values.length - 1);
  const pts = values.map((v, i) => [i * step, H - 3 - (v / max) * (H - 6)] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left) / r.width) * (values.length - 1));
    const k = Math.max(0, Math.min(values.length - 1, i));
    setHover(k);
    tipShow(e, titles[k], [{ label, value: String(values[k]) }]);
  };
  return (
    <div ref={tipRef} className={styles.sparkWrap}>
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.spark} preserveAspectRatio="none" onPointerMove={onMove} onPointerLeave={() => (setHover(null), tipHide())} aria-label={`${label} trend`} role="img">
        <path d={`${d}L${W},${H}L0,${H}Z`} fill={color} opacity={0.12} />
        <path d={d} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null ? <line x1={pts[hover][0]} x2={pts[hover][0]} y1={0} y2={H} className={styles.crosshair} vectorEffect="non-scaling-stroke" /> : null}
      </svg>
      {tipNode}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Horizontal bars with direct labels (funnel, outcomes, decline reasons). */
export function BarList({ items, color, emptyText = "Nothing in this period." }: { items: { label: string; value: number; note?: string; color?: string }[]; color: string; emptyText?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length || items.every((i) => i.value === 0)) return <p className={styles.note}>{emptyText}</p>;
  return (
    <ul className={styles.barList}>
      {items.map((i) => (
        <li key={i.label} title={`${i.label}: ${i.value}${i.note ? ` (${i.note})` : ""}`}>
          <div className={styles.barListHead}>
            <span>{i.label}</span>
            <span className={styles.barListValue}>
              <strong>{i.value}</strong>
              {i.note ? <span className={styles.muted}> {i.note}</span> : null}
            </span>
          </div>
          <div className={styles.barTrack}>
            <div className={styles.barFill} style={{ width: `${(i.value / max) * 100}%`, background: i.color ?? color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** One 100% bar split into parts, with a legend carrying the values. */
export function SplitBar({ parts }: { parts: { label: string; value: number; display: string; color: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <div>
      <div className={styles.splitBar} role="img" aria-label={parts.map((p) => `${p.label} ${p.display}`).join(", ")}>
        {total > 0 ? (
          parts.filter((p) => p.value > 0).map((p) => <div key={p.label} style={{ flexGrow: p.value, background: p.color }} title={`${p.label}: ${p.display}`} />)
        ) : (
          <div style={{ flexGrow: 1 }} className={styles.splitEmpty} />
        )}
      </div>
      <ul className={styles.legend}>
        {parts.map((p) => (
          <li key={p.label}>
            <span className={styles.legendSwatch} style={{ background: p.color }} />
            {p.label} <strong>{p.display}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Card({ title, subtitle, children, action, className }: { title: string; subtitle?: string; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <section className={`${styles.card} ${className ?? ""}`}>
      <header className={styles.cardHead}>
        <div>
          <h2 className={styles.cardTitle}>{title}</h2>
          {subtitle ? <p className={styles.cardSub}>{subtitle}</p> : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}
