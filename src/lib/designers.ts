import { db, must } from "./db";
import type { Designer } from "./types";

/** True if any of the designer's areas appears in the caller's location (case-insensitive). */
export function coversLocation(d: Designer, location: string | null | undefined): boolean {
  if (!location) return false;
  const loc = location.toLowerCase();
  return d.areas.some((a) => a.trim() && loc.includes(a.trim().toLowerCase()));
}

/**
 * Round-robin among active designers, preferring those whose areas cover the location.
 * "Round-robin" = least recently assigned first (never-assigned first of all).
 * Pure so it can be unit-tested; see pickDesigner for the DB version.
 */
export function chooseDesigner(designers: Designer[], location: string | null | undefined, opts: { requireCalendar?: boolean } = {}): Designer | null {
  let pool = designers.filter((d) => d.active && (!opts.requireCalendar || d.calcom_event_type_id != null));
  const local = pool.filter((d) => coversLocation(d, location));
  if (local.length) pool = local;
  pool.sort((a, b) => (a.last_assigned_at ?? "").localeCompare(b.last_assigned_at ?? ""));
  return pool[0] ?? null;
}

export async function listDesigners(): Promise<Designer[]> {
  return must(await db().from("designers").select("*").order("name"), "designers list") as Designer[];
}

export async function pickDesigner(location: string | null | undefined, opts: { requireCalendar?: boolean } = {}): Promise<Designer | null> {
  return chooseDesigner(await listDesigners(), location, opts);
}

export async function getDesigner(id: string): Promise<Designer | null> {
  return must(await db().from("designers").select("*").eq("id", id).maybeSingle(), "designer get") as Designer | null;
}

export async function markAssigned(id: string): Promise<void> {
  must(await db().from("designers").update({ last_assigned_at: new Date().toISOString() }).eq("id", id), "designer markAssigned");
}
