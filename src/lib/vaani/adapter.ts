// THE ONLY FILE THAT KNOWS VAANI'S PAYLOAD SHAPES.
//
// Provider: Vaani AI (app.vaanivoice.ai). Docs: https://docs.vaanivoice.ai
//   - Webhook events and payloads: /guides/webhook-setup
//   - Signature: /api-reference/campaigns/webhooks ("Vaani signs all webhook payloads"):
//       X-Vaani-Signature: sha256=<hex HMAC-SHA256 of "{X-Vaani-Timestamp}.{raw body}">
//       X-Vaani-Timestamp: unix seconds; reject if more than 5 minutes off.
//     The secret is the one we type into Developers → Webhooks → "Secret".
//   - Mid-call tools: Design → Tools & Actions → Create Custom Tool. Vaani calls our URL with
//     the headers we configure (we send `Authorization: Bearer <VAANI_TOOL_SECRET>`) and the
//     parameters the agent extracted; the agent reads back fields we map from our JSON reply.
//
// Events we use (inbound calls): call_started (caller number), call_ended (duration, seconds),
// call_postprocessing (transcript + summary; call_duration in MILLISECONDS).

import { createHmac, timingSafeEqual } from "node:crypto";
import type { NormalizedInteraction, NormalizedToolCall, TranscriptTurn } from "../types";

export const PROVIDER = "vaani";
const MAX_SKEW_S = 5 * 60;

export class VaaniNotConfiguredError extends Error {
  constructor(what: string) {
    super(`Vaani adapter not configured: ${what}`);
  }
}

// ---------------------------------------------------------------------------
// Webhooks

export function verifyWebhookSignature(rawBody: string, headers: Headers, nowS = Math.floor(Date.now() / 1000)): boolean {
  const secret = process.env.VAANI_WEBHOOK_SECRET;
  if (!secret) throw new VaaniNotConfiguredError("VAANI_WEBHOOK_SECRET is not set");
  const sig = /^sha256=([0-9a-f]{64})$/.exec(headers.get("x-vaani-signature") ?? "");
  const ts = headers.get("x-vaani-timestamp") ?? "";
  if (!sig || !/^\d{9,11}$/.test(ts) || Math.abs(nowS - Number(ts)) > MAX_SKEW_S) return false;
  const expected = createHmac("sha256", secret).update(`${ts}.${rawBody}`, "utf8").digest();
  const got = Buffer.from(sig[1], "hex");
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export interface VaaniEvent {
  /** Stable per event and call; Vaani's agent webhooks carry no event id, so we build one. */
  key: string;
  event: string;
  callId: string | null;
  body: Record<string, unknown>;
  data: Record<string, unknown>;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);

export function parseWebhookEvent(payload: unknown): VaaniEvent {
  const body = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const event = str(body.event);
  if (!event) throw new Error("Vaani webhook without an event name");
  const data = (body.data && typeof body.data === "object" ? body.data : {}) as Record<string, unknown>;
  const callId = str(body.call_id) ?? str(data.call_id) ?? str(body.room_name) ?? str(data.room_name);
  return { key: `${event}:${callId ?? "unknown"}`, event, callId, body, data };
}

/** E.164 for Indian numbers; anything already international is kept. */
export function normalisePhone(raw: unknown): string | null {
  const s = str(raw);
  if (!s) return null;
  const d = s.replace(/\D/g, "");
  if (d.length === 10) return `+91${d}`;
  if (d.length === 12 && d.startsWith("91")) return `+${d}`;
  if (d.length === 11 && d.startsWith("0")) return `+91${d.slice(1)}`;
  return s.startsWith("+") && d.length >= 8 ? `+${d}` : null;
}

/** call_started: the caller's number (inbound) and the room/call id. */
export function callStartedInfo(e: VaaniEvent): { callId: string; callerPhone: string | null } | null {
  if (!e.callId) return null;
  return { callId: e.callId, callerPhone: normalisePhone(e.body.phone_number ?? e.data.phone_number) };
}

/** call_ended: duration in SECONDS. */
export function callEndedInfo(e: VaaniEvent): { callId: string; durationSeconds: number | null; endReason: string | null } | null {
  if (!e.callId) return null;
  return { callId: e.callId, durationSeconds: num(e.body.call_duration ?? e.data.call_duration), endReason: str(e.body.end_reason ?? e.data.end_reason) };
}

/** "[13:33:14] AGENT: Hi...\n\n[13:33:19] USER: Hello" → turns. Continuation lines join the previous turn. */
export function parseTranscript(text: unknown): TranscriptTurn[] {
  const s = str(text);
  if (!s) return [];
  const turns: TranscriptTurn[] = [];
  for (const line of s.split(/\r?\n/)) {
    const m = /^\s*(?:\[[\d:]+\]\s*)?(AGENT|ASSISTANT|BOT|USER|CUSTOMER|CALLER)\s*:\s*(.*)$/i.exec(line);
    if (m) turns.push({ role: /^(agent|assistant|bot)$/i.test(m[1]) ? "agent" : "caller", text: m[2].trim() });
    else if (line.trim() && turns.length) turns[turns.length - 1].text += ` ${line.trim()}`;
  }
  return turns.filter((t) => t.text);
}

/** call_postprocessing → NormalizedInteraction. call_duration here is MILLISECONDS. */
export function parseCallWebhook(e: VaaniEvent): NormalizedInteraction {
  if (!e.callId) throw new Error("call_postprocessing without call_id");
  const durationMs = num(e.data.call_duration ?? e.body.call_duration);
  const durationSeconds = durationMs != null ? Math.round(durationMs / 1000) : null;
  const endedAt = str(e.body.timestamp) ? new Date(str(e.body.timestamp)!).toISOString() : null;
  const startedAt = endedAt && durationSeconds != null ? new Date(new Date(endedAt).getTime() - durationSeconds * 1000).toISOString() : null;
  return {
    channel: "phone",
    provider: PROVIDER,
    externalId: e.callId,
    callerPhone: normalisePhone(e.data.phone_number ?? e.body.phone_number),
    startedAt,
    endedAt,
    durationSeconds,
    transcript: parseTranscript(e.data.transcript ?? e.body.transcript),
  };
}

// ---------------------------------------------------------------------------
// Mid-call tools (Vaani "Custom Tool": our headers + extracted parameters)

export function verifyToolRequest(_rawBody: string, headers: Headers): boolean {
  const secret = process.env.VAANI_TOOL_SECRET;
  if (!secret) throw new VaaniNotConfiguredError("VAANI_TOOL_SECRET is not set");
  const got = Buffer.from(headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** Parameters may arrive flat or wrapped; call id is used if Vaani provides one, else matched by phone later. */
export function parseToolCall(payload: unknown): NormalizedToolCall {
  const body = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const nested = [body.parameters, body.args, body.arguments].find((v) => v && typeof v === "object") as Record<string, unknown> | undefined;
  const args = { ...body, ...(nested ?? {}) };
  return {
    externalCallId: str(args.call_id) ?? str(args.room_name),
    callerPhone: normalisePhone(args.phone ?? args.caller_phone ?? args.phone_number),
    args,
  };
}

/** Flat JSON so a "Store Fields as Variables" mapping of `$.message` gives the agent its line. */
export function toToolResponse(result: { ok: boolean; message: string; data?: unknown }): unknown {
  return { ok: result.ok, message: result.message, data: result.data ?? null };
}

// ---------------------------------------------------------------------------
// In-browser web calls (POST /api/trigger-call/ with medium "webrtc").
// Returns a short-lived LiveKit token; the browser joins the room with livekit-client.

export interface WebCallSession {
  token: string;
  connectionUrl: string;
  roomName: string;
}

export async function startWebCall(opts: { maxMinutes: number; greeting: string }): Promise<WebCallSession> {
  const apiKey = process.env.VAANI_API_KEY;
  // Not a secret (useless without the API key); default lets the deployed app work without another env var.
  const agentId = process.env.VAANI_AGENT_ID || "2ac6c163-7d11-4eb9-9b67-5338719fdd52";
  if (!apiKey || !agentId) throw new VaaniNotConfiguredError("VAANI_API_KEY / VAANI_AGENT_ID not set");
  const res = await fetch("https://api.vaanivoice.ai/api/trigger-call/", {
    method: "POST",
    headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      agent_id: agentId,
      medium: "webrtc",
      primary_language: "en",
      secondary_language: "hi",
      welcome_message: opts.greeting,
      welcome_interruptible: true,
      modify_agent: { experience: { settings: { call_settings: { max_call_duration: opts.maxMinutes } } } },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Vaani web call ${res.status}: ${text.slice(0, 200)}`);
  const j = JSON.parse(text) as Record<string, unknown>;
  const token = str(j.token), connectionUrl = str(j.connection_url), roomName = str(j.room_name);
  if (!token || !connectionUrl || !roomName) throw new Error("Vaani web call: missing token/connection_url/room_name");
  return { token, connectionUrl, roomName };
}
