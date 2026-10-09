// Live-call tools. Provider-neutral: the route handlers translate Vaani's request/response
// shape through the adapter and call these. Hard budget: respond within 2 seconds.

import { createBooking, getSlots, pickSlots } from "./calcom";
import { db, must } from "./db";
import { getDesigner, markAssigned, pickDesigner } from "./designers";
import { log } from "./log";
import { formatIstSpoken } from "./time";
import type { Designer, NormalizedToolCall } from "./types";

export const TOOL_DEADLINE_MS = 1800;
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
async function ensureCallRow(tool: NormalizedToolCall, patch: Record<string, unknown> = {}): Promise<{ id: string; designer_id: string | null } | null> {
  if (!tool.externalCallId) {
    log.warn("tool.no_call_id");
    return null;
  }
  const existing = must(
    await db().from("calls").select("id, designer_id").eq("provider", "vaani").eq("external_id", tool.externalCallId).maybeSingle(),
    "tool call lookup",
  ) as { id: string; designer_id: string | null } | null;
  if (existing) {
    if (Object.keys(patch).length) must(await db().from("calls").update(patch).eq("id", existing.id), "tool call patch");
    return { ...existing, ...(patch.designer_id ? { designer_id: patch.designer_id as string } : {}) };
  }
  return must(
    await db()
      .from("calls")
      .insert({ provider: "vaani", channel: "phone", external_id: tool.externalCallId, status: "in_call", caller_phone: tool.callerPhone, ...patch })
      .select("id, designer_id")
      .single(),
    "tool call insert",
  ) as { id: string; designer_id: string | null };
}

async function markBookingFailed(tool: NormalizedToolCall): Promise<void> {
  if (!tool.externalCallId) return;
  const call = await ensureCallRow(tool);
  // Never downgrade a booking that landed after the deadline fired.
  if (call) await db().from("calls").update({ booking_status: "booking_failed" }).eq("id", call.id).neq("booking_status", "booked");
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
    const call = await ensureCallRow(tool);
    const designer = await designerFor(call, location);
    if (call && call.designer_id !== designer.id) {
      // Tentative: the round-robin pointer only moves when a booking is made.
      await db().from("calls").update({ designer_id: designer.id }).eq("id", call.id);
    }

    const now = new Date();
    const all = await getSlots(designer.calcom_event_type_id!, now, new Date(now.getTime() + 7 * 864e5), remaining(deadline));
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
    const slot = str(tool.args.slot) ?? str(tool.args.start);
    const start = slot ? new Date(slot) : null;
    if (!start || Number.isNaN(start.getTime()) || start.getTime() < Date.now()) throw new Error("Invalid or past slot");

    const name = str(tool.args.caller_name) ?? str(tool.args.name) ?? "Aangan caller";
    const location = str(tool.args.location);
    const consultationMode = mode(tool.args.consultation_mode);
    const phone = str(tool.args.phone) ?? tool.callerPhone;

    const call = await ensureCallRow(tool);
    const designer = await designerFor(call, location);

    const booking = await createBooking(
      {
        eventTypeId: designer.calcom_event_type_id!,
        startUtc: start.toISOString(),
        attendeeName: name,
        attendeePhone: phone,
        notes: [location && `Location: ${location}`, consultationMode && `Consultation at: ${consultationMode}`, "Booked by the Aangan phone agent"].filter(Boolean).join(". "),
        metadata: { source: "phone_agent", ...(tool.externalCallId ? { call_id: tool.externalCallId } : {}) },
      },
      remaining(deadline),
    );

    if (call) {
      must(
        await db()
          .from("calls")
          .update({ designer_id: designer.id, booking_status: "booked", booking_uid: booking.uid, booking_start: booking.start, consultation_mode: consultationMode })
          .eq("id", call.id),
        "store booking",
      );
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
