// Cal.com API v2. Each designer has their own event type (designers.calcom_event_type_id),
// so a slot fetched for a designer is on that designer's calendar.

import { env, envOptional } from "./env";
import { IST_TZ } from "./time";

const BASE = "https://api.cal.com/v2";
const SLOTS_API_VERSION = "2024-09-04";
const BOOKINGS_API_VERSION = "2026-02-25";

function headers(version: string): HeadersInit {
  return { Authorization: `Bearer ${env("CALCOM_API_KEY")}`, "cal-api-version": version, "Content-Type": "application/json" };
}

/** All open slot start times (UTC ISO) for an event type between start and end. */
export async function getSlots(eventTypeId: number, start: Date, end: Date, timeoutMs: number): Promise<string[]> {
  const qs = new URLSearchParams({
    eventTypeId: String(eventTypeId),
    start: start.toISOString(),
    end: end.toISOString(),
    timeZone: IST_TZ,
  });
  const res = await fetch(`${BASE}/slots?${qs}`, { headers: headers(SLOTS_API_VERSION), signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`Cal.com slots ${res.status}`);
  const body = (await res.json()) as { status: string; data: Record<string, { start: string }[]> };
  return Object.values(body.data ?? {})
    .flat()
    .map((s) => new Date(s.start).toISOString())
    .sort();
}

/** Prefer one slot per day across different days, then fill. */
export function pickSlots(slots: string[], count = 3): string[] {
  const byDay = new Map<string, string>();
  for (const s of slots) {
    const day = new Date(new Date(s).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, s);
  }
  const picked = [...byDay.values()].slice(0, count);
  for (const s of slots) if (picked.length < count && !picked.includes(s)) picked.push(s);
  return picked.sort();
}

export interface BookingInput {
  eventTypeId: number;
  startUtc: string;
  attendeeName: string;
  attendeePhone: string | null;
  /** Where the consultation happens; sent as the event's "attendee address" location. */
  address: string;
  /** Free text the designer sees on the calendar event. */
  notes: string;
  metadata: Record<string, string>;
}

/** Cal.com wants international format (+919876543210). Indian 10-digit numbers get +91. */
export function toInternationalPhone(raw: string | null): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return `+91${d}`;
  if (d.length === 12 && d.startsWith("91")) return `+${d}`;
  if (d.length === 11 && d.startsWith("0")) return `+91${d.slice(1)}`;
  return raw.trim().startsWith("+") ? `+${d}` : null;
}

export async function createBooking(b: BookingInput, timeoutMs: number): Promise<{ uid: string; start: string }> {
  const attendee: Record<string, string> = { name: b.attendeeName, timeZone: IST_TZ, language: "en" };
  const phone = toInternationalPhone(b.attendeePhone);
  if (phone) attendee.phoneNumber = phone; // required by the Consultation event's booking form
  // Callers rarely give an email on the phone. If the studio wants every booking to carry one,
  // set CALCOM_FALLBACK_ATTENDEE_EMAIL (e.g. a shared leads inbox).
  const fallbackEmail = envOptional("CALCOM_FALLBACK_ATTENDEE_EMAIL");
  if (fallbackEmail) attendee.email = fallbackEmail;

  const res = await fetch(`${BASE}/bookings`, {
    method: "POST",
    headers: headers(BOOKINGS_API_VERSION),
    body: JSON.stringify({
      start: b.startUtc,
      eventTypeId: b.eventTypeId,
      attendee,
      // The Consultation event uses "In Person (Attendee Address)"; Cal.com requires the address.
      location: { type: "attendeeAddress", address: b.address },
      bookingFieldsResponses: { notes: b.notes },
      metadata: b.metadata,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Cal.com booking ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { status: string; data: { uid: string; start: string } | { uid: string; start: string }[] };
  const data = Array.isArray(body.data) ? body.data[0] : body.data;
  if (!data?.uid) throw new Error("Cal.com booking returned no uid");
  return { uid: data.uid, start: data.start };
}
