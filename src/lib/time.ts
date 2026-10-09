// IST helpers. India has no DST, so IST is always UTC+05:30.

export const IST_TZ = "Asia/Kolkata";
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Start of the IST calendar day containing `d`, as a UTC Date. */
export function startOfIstDay(d: Date): Date {
  const shifted = new Date(d.getTime() + IST_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - IST_OFFSET_MS);
}

export type RangeKey = "today" | "week" | "month";

/** [start, end) in UTC for today / this week (Mon–Sun) / this month, in IST. */
export function istRange(key: RangeKey, now = new Date()): { start: Date; end: Date } {
  const dayStart = startOfIstDay(now);
  if (key === "today") return { start: dayStart, end: new Date(dayStart.getTime() + 864e5) };
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  if (key === "week") {
    const daysSinceMonday = (ist.getUTCDay() + 6) % 7;
    const start = new Date(dayStart.getTime() - daysSinceMonday * 864e5);
    return { start, end: new Date(start.getTime() + 7 * 864e5) };
  }
  const monthStartIst = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1);
  const nextMonthIst = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() + 1, 1);
  return { start: new Date(monthStartIst - IST_OFFSET_MS), end: new Date(nextMonthIst - IST_OFFSET_MS) };
}

/** Yesterday in IST as [start, end) plus a YYYY-MM-DD label. */
export function istYesterday(now = new Date()): { start: Date; end: Date; label: string } {
  const end = startOfIstDay(now);
  const start = new Date(end.getTime() - 864e5);
  return { start, end, label: istDateKey(start) };
}

export function istDateKey(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Outside the 10:00–19:00 IST front-desk window. */
export function isAfterHours(d: Date): boolean {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return minutes < 10 * 60 || minutes >= 19 * 60;
}

/** "Sat 11 Oct, 11:00 am" in IST. */
export function formatIst(d: Date | string, opts: { withYear?: boolean } = {}): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: IST_TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(opts.withYear ? { year: "numeric" } : {}),
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

/** Spoken form for the voice agent: "Saturday, 11 October at 11:00 am". */
export function formatIstSpoken(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const day = new Intl.DateTimeFormat("en-IN", { timeZone: IST_TZ, weekday: "long", day: "numeric", month: "long" }).format(date);
  const time = new Intl.DateTimeFormat("en-IN", { timeZone: IST_TZ, hour: "numeric", minute: "2-digit", hour12: true }).format(date);
  return `${day} at ${time}`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "–";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
