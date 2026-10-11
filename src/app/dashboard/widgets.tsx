"use client";

// Call-centre widgets in the style of Voiso / Aircall dashboards: donut with a counted
// legend, service-level gauges, a volume area chart, and ringed stat badges.
// Same rules as charts.tsx: legend for >=2 series, hover + focus tooltips, status colour
// always paired with an icon and a label.

import { useState } from "react";
import { niceMax, useTooltip } from "./charts";
import styles from "./dashboard.module.css";

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number) {
  const p = (a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${x0.toFixed(2)},${y0.toFixed(2)}A${r},${r} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
}

/** Part-to-whole donut (<= 6 segments) with the total in the centre and a counted legend. */
export function Donut({ items, totalLabel }: { items: { key: string; label: string; value: number; color: string }[]; totalLabel: string }) {
  const { ref: tipRef, show: tipShow, hide: tipHide, node: tipNode } = useTooltip();
  const [active, setActive] = useState<string | null>(null);
  const total = items.reduce((s, i) => s + i.value, 0);
  const R = 70;
  const W = 18;
  const C = 90;
  const nonZero = items.filter((i) => i.value > 0);
  const gap = nonZero.length > 1 ? 0.035 : 0; // ~2px surface gap between segments
  const segs = nonZero.map((i, idx) => {
    const before = nonZero.slice(0, idx).reduce((s, x) => s + x.value, 0);
    const a0 = -Math.PI / 2 + (before / total) * Math.PI * 2;
    const a1 = a0 + (i.value / total) * Math.PI * 2;
    return { ...i, a0: a0 + gap / 2, a1: a1 - gap / 2 };
  });
  const pct = (v: number) => (total ? `${Math.round((v / total) * 100)}%` : "–");
  const tip = (s: { label: string; value: number; color: string }) => [{ color: s.color, label: pct(s.value), value: String(s.value) }];

  return (
    <div className={styles.donutWrap}>
      <div ref={tipRef} className={styles.donutChart}>
        <svg viewBox={`0 0 ${C * 2} ${C * 2}`} role="img" aria-label={`${totalLabel}: ${total}`}>
          <circle cx={C} cy={C} r={R} fill="none" stroke="var(--surface-2)" strokeWidth={W} />
          {segs.map((s) => {
            const full = nonZero.length === 1;
            return full ? (
              <circle key={s.key} cx={C} cy={C} r={R} fill="none" stroke={s.color} strokeWidth={W} />
            ) : (
              <path
                key={s.key}
                d={arcPath(C, C, R, s.a0, s.a1)}
                fill="none"
                stroke={s.color}
                strokeWidth={active === s.key ? W + 4 : W}
                tabIndex={0}
                aria-label={`${s.label}: ${s.value}`}
                className={styles.donutSeg}
                onPointerMove={(e) => {
                  setActive(s.key);
                  tipShow(e, s.label, tip(s));
                }}
                onPointerLeave={() => {
                  setActive(null);
                  tipHide();
                }}
                onFocus={(e) => {
                  setActive(s.key);
                  tipShow(e.currentTarget.getBoundingClientRect(), s.label, tip(s));
                }}
                onBlur={() => {
                  setActive(null);
                  tipHide();
                }}
              />
            );
          })}
        </svg>
        <div className={styles.donutCenter} aria-hidden>
          <span className={styles.donutTotalLabel}>{totalLabel}</span>
          <span className={styles.donutTotal}>{total}</span>
        </div>
        {tipNode}
      </div>
      <ul className={styles.donutLegend}>
        {items.map((i) => (
          <li key={i.key} className={active === i.key ? styles.donutLegendActive : undefined} onPointerEnter={() => setActive(i.key)} onPointerLeave={() => setActive(null)}>
            <span className={styles.legendDot} style={{ background: i.color }} />
            <span className={styles.donutLegendLabel}>{i.label}</span>
            <strong>{i.value}</strong>
            <span className={styles.donutLegendPct}>{pct(i.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

type Level = "good" | "warning" | "critical" | "none";
const LEVEL_COLOR: Record<Level, string> = { good: "var(--good)", warning: "var(--warning)", critical: "var(--critical)", none: "var(--axis)" };
const LEVEL_TEXT: Record<Level, string> = { good: "On target", warning: "Below target", critical: "Off target", none: "No data yet" };
const LEVEL_ICON: Record<Level, string> = { good: "✓", warning: "!", critical: "!", none: "–" };

/** Semicircle meter: the fill carries the status; the track is a lighter step of the same colour. */
export function Gauge({ label, percent, level, detail, footnote }: { label: string; percent: number | null; level: Level; detail: string; footnote?: string }) {
  const color = LEVEL_COLOR[level];
  const R = 80;
  const cx = 100;
  const cy = 96;
  const value = Math.min(100, Math.max(0, percent ?? 0));
  const end = Math.PI + (value / 100) * Math.PI;
  return (
    <div className={styles.gauge}>
      <svg viewBox="0 0 200 116" role="img" aria-label={`${label}: ${percent === null ? "no data" : `${percent}%`}, ${LEVEL_TEXT[level]}`}>
        <path d={arcPath(cx, cy, R, Math.PI, 2 * Math.PI - 0.0001)} fill="none" stroke={`color-mix(in srgb, ${color} 20%, var(--surface))`} strokeWidth={14} strokeLinecap="round" />
        {percent !== null && value > 0 ? <path d={arcPath(cx, cy, R, Math.PI, end - 0.0001)} fill="none" stroke={color} strokeWidth={14} strokeLinecap="round" /> : null}
        <text x={cx} y={cy - 6} textAnchor="middle" className={styles.gaugeValue}>
          {percent === null ? "–" : `${percent}%`}
        </text>
        <text x={cx - R} y={cy + 18} textAnchor="middle" className={styles.axisText}>
          0
        </text>
        <text x={cx + R} y={cy + 18} textAnchor="middle" className={styles.axisText}>
          100
        </text>
      </svg>
      <span className={styles.levelPill} style={{ color: level === "warning" || level === "none" ? "var(--ink)" : color, background: `color-mix(in srgb, ${color} 15%, transparent)` }}>
        <span aria-hidden>{LEVEL_ICON[level]}</span> {label}
      </span>
      <div className={styles.gaugeDetail}>
        <strong>{LEVEL_TEXT[level]}</strong> · {detail}
      </div>
      {footnote ? <div className={styles.gaugeDetail}>{footnote}</div> : null}
    </div>
  );
}

interface VolumePoint {
  key: string;
  label: string;
  title: string;
  calls: number;
  qualified: number;
}

/** Calls and qualified leads over time: two 2px lines, a soft area under the total, crosshair tooltip. */
export function VolumeChart({ data, labelEvery = 1 }: { data: VolumePoint[]; labelEvery?: number }) {
  const { ref: tipRef, show: tipShow, hide: tipHide, node: tipNode } = useTooltip();
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 230;
  const pad = { l: 28, r: 12, t: 10, b: 24 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const max = niceMax(Math.max(1, ...data.map((d) => d.calls)));
  // Grouped bars: counts per period are discrete, and sparse data reads honestly as bars.
  const band = plotW / Math.max(1, data.length);
  const x = (i: number) => pad.l + band * (i + 0.5); // band centre
  const y = (v: number) => pad.t + plotH - (v / max) * plotH;
  const barW = Math.max(3, Math.min(22, band * 0.32));
  const gap = Math.min(3, band * 0.04);
  const rows = (i: number) => [
    { color: "var(--series-1)", label: "calls", value: String(data[i].calls) },
    { color: "var(--series-2)", label: "qualified", value: String(data[i].qualified) },
  ];
  const pick = (i: number, clientX: number, clientY: number) => {
    setHover(i);
    tipShow({ clientX, clientY }, data[i].title, rows(i));
  };

  return (
    <div ref={tipRef} className={styles.chartWrap}>
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.chartSvg} role="img" aria-label="Calls and qualified leads over time">
        {[0, max / 2, max].map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className={t === 0 ? styles.baseline : styles.gridline} />
            <text x={pad.l - 6} y={y(t)} dy="0.32em" textAnchor="end" className={styles.axisText}>
              {Number.isInteger(t) ? t : t.toFixed(1)}
            </text>
          </g>
        ))}
        {hover !== null ? (
          <rect x={x(hover) - band / 2} y={pad.t} width={band} height={plotH} fill="var(--ink)" opacity={0.05} />
        ) : null}
        {data.map((d, i) => (
          <g key={d.key}>
            {d.calls > 0 ? (
              <rect x={x(i) - barW - gap / 2} y={y(d.calls)} width={barW} height={y(0) - y(d.calls)} rx={2} fill="var(--series-1)" />
            ) : null}
            {d.qualified > 0 ? (
              <rect x={x(i) + gap / 2} y={y(d.qualified)} width={barW} height={y(0) - y(d.qualified)} rx={2} fill="var(--series-2)" />
            ) : null}
          </g>
        ))}
        {data.map((d, i) =>
          i % labelEvery === 0 ? (
            <text key={d.key} x={x(i)} y={H - 6} textAnchor="middle" className={styles.axisText}>
              {d.label}
            </text>
          ) : null,
        )}
        <rect
          x={pad.l}
          y={pad.t}
          width={plotW}
          height={plotH}
          fill="transparent"
          tabIndex={0}
          aria-label="Calls over time. Use left and right arrow keys to read each period."
          className={styles.hitGroup}
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const i = Math.max(0, Math.min(data.length - 1, Math.floor(((e.clientX - r.left) / r.width) * data.length)));
            pick(i, e.clientX, e.clientY);
          }}
          onPointerLeave={() => {
            setHover(null);
            tipHide();
          }}
          onKeyDown={(e) => {
            if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
            e.preventDefault();
            const i = Math.max(0, Math.min(data.length - 1, (hover ?? -1) + (e.key === "ArrowRight" ? 1 : -1)));
            const r = e.currentTarget.getBoundingClientRect();
            pick(i, r.left + ((i + 0.5) / data.length) * r.width, r.top + 24);
          }}
          onBlur={() => {
            setHover(null);
            tipHide();
          }}
        />
      </svg>
      {tipNode}
    </div>
  );
}

/** Ringed stat badge (the round "campaign status" figures). */
export function RingStat({ label, value, tone = "brand" }: { label: string; value: string; tone?: "brand" | "good" | "critical" }) {
  const color = tone === "good" ? "var(--good)" : tone === "critical" ? "var(--critical)" : "var(--series-1)";
  return (
    <div className={styles.ringStat}>
      <span className={styles.ring} style={{ borderColor: color }}>
        {value}
      </span>
      <span className={styles.ringLabel}>{label}</span>
    </div>
  );
}
