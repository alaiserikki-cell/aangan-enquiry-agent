// THE ONLY FILE THAT KNOWS VAANI'S PAYLOAD SHAPES.
//
// Source: VaaniVoice Public API, OpenAPI 3.1 (https://vaanilabs.in/openapi/v1/vaanivoice.yaml).
//
// IMPLEMENTED (documented in the spec):
//   - Webhook signature: header `X-VaaniVoice-Signature: sha256=<hex>`, HMAC-SHA256 over the
//     exact raw body bytes, keyed with the `vv_whk_...` secret shown once at registration.
//   - Envelope: { id: "evt_...", type, created (unix s), data }. `id` is reused across retries.
//     Event types: call.completed, call.failed, meeting.ended, lead.created, usage.charged,
//     low_balance.warned, plus the dashboard test event webhook.ping.
//
// NOT YET IMPLEMENTED (not in the public docs; do not guess):
//   - parseCallWebhook: the fields inside `data` for call.completed / call.failed. The spec only
//     says "Phone numbers are masked. Defensive-parse, no sub-field is guaranteed."
//     Every raw event is stored in `webhook_events`, so the first real call shows the shape.
//   - Mid-call tool requests (verifyToolRequest / parseToolCall / toToolResponse): the public
//     spec has no tool/function-calling section.
//   - Inbound number → agent: the docs only say "Configure your Twilio number".

import { createHmac, timingSafeEqual } from "node:crypto";
import type { NormalizedInteraction, NormalizedToolCall } from "../types";

export const PROVIDER = "vaani";

export class VaaniNotConfiguredError extends Error {
  constructor(what: string) {
    super(`Vaani adapter not implemented yet (${what}). Waiting on details missing from Vaani's public docs.`);
  }
}

export interface WebhookEnvelope {
  eventId: string;
  type: string;
  created: number | null;
  data: Record<string, unknown>;
}

export const CALL_EVENTS = new Set(["call.completed", "call.failed"]);

/** Verify `X-VaaniVoice-Signature` over the RAW request body (constant-time compare). */
export function verifyWebhookSignature(rawBody: string, headers: Headers): boolean {
  const secret = process.env.VAANI_WEBHOOK_SECRET;
  if (!secret) throw new VaaniNotConfiguredError("VAANI_WEBHOOK_SECRET is not set");
  const header = headers.get("x-vaanivoice-signature") ?? "";
  const match = /^sha256=([0-9a-f]{64})$/.exec(header);
  if (!match) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const got = Buffer.from(match[1], "hex");
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** The signed envelope every delivery carries. Throws on a malformed envelope. */
export function parseWebhookEnvelope(payload: unknown): WebhookEnvelope {
  const p = (payload ?? {}) as Record<string, unknown>;
  if (typeof p.id !== "string" || !p.id || typeof p.type !== "string") throw new Error("Malformed VaaniVoice envelope");
  return {
    eventId: p.id,
    type: p.type,
    created: typeof p.created === "number" ? p.created : null,
    data: p.data && typeof p.data === "object" ? (p.data as Record<string, unknown>) : {},
  };
}

/** call.completed / call.failed `data` → NormalizedInteraction. Pending a real sample payload. */
export function parseCallWebhook(_envelope: WebhookEnvelope): NormalizedInteraction {
  throw new VaaniNotConfiguredError("call event data mapping");
}

/** Authenticate a mid-call tool request from Vaani. */
export function verifyToolRequest(_rawBody: string, _headers: Headers): boolean {
  throw new VaaniNotConfiguredError("verifyToolRequest");
}

/** Vaani tool-call request JSON → NormalizedToolCall. */
export function parseToolCall(_payload: unknown): NormalizedToolCall {
  throw new VaaniNotConfiguredError("parseToolCall");
}

/** Our tool result → the response body Vaani expects (what the agent reads back). */
export function toToolResponse(_result: { ok: boolean; message: string; data?: unknown }): unknown {
  throw new VaaniNotConfiguredError("toToolResponse");
}
