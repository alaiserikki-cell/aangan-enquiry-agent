// Live-call tools. Provider-neutral: the route handlers translate Vaani's request/response
// shape through the adapter and call these. Hard budget: respond within 2 seconds.

import { createBooking, getSlots, pickSlots } from "./calcom";
import { sql, sqlOne } from "./db";
import { chooseDesigner, getDesigner, listDesigners, markAssigned, pickDesigner } from "./designers";
import { log } from "./log";
import { formatIstSpoken } from "./time";
import type { Designer, NormalizedToolCall } from "./types";

export const TOOL_DEADLINE_MS = 1800;
const MAX_BOOKING_AHEAD_MS = 8 * 864e5; // the 7-day offer window plus a day of slack
export const FALLBACK_MESSAGE = "A designer will call you within two hours to fix a time.";

export interface ToolResult {
  ok: boolean;
  /** What the agent should say / read back. */
  message: string;
  slots?: { start: string; spoken: string }[];
  booking?: { start: string; spoken: string; designer: string };
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function mode(v: unknown): "home" | "studio" | null {
  const s = str(v)?.toLowerCase();
  return s === "home" || s === "studio" ? s : null;
}

/** Race the work against the deadline; on timeout or error return the fallback and flag the call. */
async function withDeadline(tool: NormalizedToolCall, name: string, work: (deadline: number) => Promise<ToolResult>): Promise<ToolResult> {
  const deadline = Date.now() + TOOL_DEADLINE_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => (timer = setTimeout(() => resolve("timeout"), TOOL_DEADLINE_MS)));
  try {
    const result = await Promise.race([work(deadline), timeout]);
    if (result !== "timeout") return result;
    log.warn(`tool.${name}.timeout`, { callId: tool.externalCallId });
  } catch (err) {
    log.error(`tool.${name}.failed`, err, { callId: tool.externalCallId });
  } finally {
    clearTimeout(timer);
  }
  await markBookingFailed(tool).catch((e) => log.error("tool.mark_failed", e));
  return { ok: false, message: FALLBACK_MESSAGE };
}

const remaining = (deadline: number) => Math.max(300, deadline - Date.now() - 150);

/** Create the call row on the first tool call so the booking can be attached before the webhook arrives. */
type ToolCallRow = { id: string; designer_id: string | null; booking_status: string; booking_start: string | null };

/** Key for a call row created mid-call when the provider sends no call id; the webhook re-keys it by phone. */
export const pendingCallKey = (phone: string) => `pending:${phone}`;

async function ensureCallRow(tool: NormalizedToolCall): Promise<ToolCallRow | null> {
  const key = tool.externalCallId ?? (tool.callerPhone ? pendingCallKey(tool.callerPhone) : null);
  if (!key) {
    log.warn("tool.no_call_id_or_phone");
    return null;
  }
  // Insert-or-fetch in one round trip; the no-op update makes RETURNING yield the existing row.
  return sqlOne<ToolCallRow>`
    insert into calls (provider, channel, external_id, status, caller_phone)
    values ('vaani', 'phone', ${key}, 'in_call', ${tool.callerPhone})
    on conflict (provider, external_id) do update set provider = excluded.provider
    returning id, designer_id, booking_status, booking_start`;
}

async function markBookingFailed(tool: NormalizedToolCall): Promise<void> {
  if (!tool.externalCallId && !tool.callerPhone) return;
  const call = await ensureCallRow(tool);
  // Never downgrade a booking that landed after the deadline fired.
  if (call) await sql`update calls set booking_status = 'booking_failed' where id = ${call.id} and booking_status <> 'booked'`;
}

async function designerFor(call: { designer_id: string | null } | null, location: string | null): Promise<Designer> {
  if (call?.designer_id) {
    const d = await getDesigner(call.designer_id);
    if (d?.active && d.calcom_event_type_id != null) return d;
  }
  const d = await pickDesigner(location, { requireCalendar: true });
  if (!d) throw new Error("No active designer with a Cal.com event type");
  return d;
}

/** POST /api/tools/availability: three open slots in the next 7 days for the designer this caller will get. */
export function checkAvailability(tool: NormalizedToolCall): Promise<ToolResult> {
  return withDeadline(tool, "availability", async (deadline) => {
    const location = str(tool.args.location);
    // Latency budget is 2 s: fetch the call row and the designer list together, then start the
    // Cal.com request without waiting on the bookkeeping write.
    const [call, designers] = await Promise.all([ensureCallRow(tool), listDesigners()]);
    const current = call?.designer_id ? designers.find((d) => d.id === call.designer_id && d.active && d.calcom_event_type_id != null) : undefined;
    const designer = current ?? chooseDesigner(designers, location, { requireCalendar: true });
    if (!designer) throw new Error("No active designer with a Cal.com event type");

    const now = new Date();
    const slotsPromise = getSlots(designer.calcom_event_type_id!, now, new Date(now.getTime() + 7 * 864e5), remaining(deadline));
    const pin =
      call && call.designer_id !== designer.id
        ? // Tentative: the round-robin pointer only moves when a booking is made.
          sql`update calls set designer_id = ${designer.id} where id = ${call.id}`
        : Promise.resolve();
    const [all] = await Promise.all([slotsPromise, pin]);
    const slots = pickSlots(all, 3).map((start) => ({ start, spoken: formatIstSpoken(start) }));
    if (!slots.length) throw new Error("No open slots in the next 7 days");

    return {
      ok: true,
      message: `I can offer ${slots.map((s) => s.spoken).join(", or ")}. Which suits you?`,
      slots,
    };
  });
}

/** POST /api/tools/book: books the chosen slot on the assigned designer's calendar. */
export function bookConsultation(tool: NormalizedToolCall): Promise<ToolResult> {
  return withDeadline(tool, "book", async (deadline) => {
    // Guardrail: one booking per call. A repeated book request reads the existing booking back.
    const existing = await ensureCallRow(tool);
    if (existing?.booking_status === "booked" && existing.booking_start) {
      const booked = existing.designer_id ? await getDesigner(existing.designer_id) : null;
      const spoken = formatIstSpoken(existing.booking_start);
      return {
        ok: true,
        message: `You're already booked for ${spoken}${booked ? `, with ${booked.name}` : ""}. I haven't made a second booking.`,
        booking: { start: existing.booking_start, spoken, designer: booked?.name ?? "" },
      };
    }

    // Guardrail: only a real future slot inside the window check_availability offers.
    const slot = str(tool.args.slot) ?? str(tool.args.start);
    const start = slot ? new Date(slot) : null;
    if (!start || Number.isNaN(start.getTime())) throw new Error("Invalid slot");
    if (start.getTime() < Date.now() || start.getTime() > Date.now() + MAX_BOOKING_AHEAD_MS) throw new Error("Slot outside the bookable window");

    const name = str(tool.args.caller_name) ?? str(tool.args.name) ?? "Aangan caller";
    const location = str(tool.args.location);
    const consultationMode = mode(tool.args.consultation_mode);
    const phone = str(tool.args.phone) ?? tool.callerPhone;

    const call = existing;
    const designer = await designerFor(call, location);

    const booking = await createBooking(
      {
        eventTypeId: designer.calcom_event_type_id!,
        startUtc: start.toISOString(),
        attendeeName: name,
        attendeePhone: phone,
        address: consultationMode === "studio" ? "Studio visit (Aangan Studio)" : location ? `${location}, Pune (full address to confirm)` : "Caller's home (address to confirm)",
        notes: [location && `Location: ${location}`, consultationMode && `Consultation at: ${consultationMode}`, "Booked by the Aangan phone agent"].filter(Boolean).join(". "),
        metadata: { source: "phone_agent", ...(tool.externalCallId ? { call_id: tool.externalCallId } : {}) },
      },
      remaining(deadline),
    );

    if (call) {
      await sql`
        update calls set designer_id = ${designer.id}, booking_status = 'booked', booking_uid = ${booking.uid},
          booking_start = ${booking.start}, consultation_mode = ${consultationMode}
        where id = ${call.id}`;
    }
    await markAssigned(designer.id);

    const spoken = formatIstSpoken(booking.start);
    const where = consultationMode === "home" ? " at your home" : consultationMode === "studio" ? " at our studio" : "";
    return {
      ok: true,
      message: `You're booked for ${spoken}${where}, with ${designer.name}. ${designer.name} will call you before the consultation to confirm.`,
      booking: { start: booking.start, spoken, designer: designer.name },
    };
  });
}
