// THE ONLY FILE THAT KNOWS VAANI'S PAYLOAD SHAPES.
//
// Status: NOT IMPLEMENTED. Waiting on Vaani Labs API docs. Nothing here guesses at Vaani's
// format. Each function below throws VaaniNotConfiguredError until it is written against the docs.
//
// To finish, answer from the docs:
//   1. Inbound number → agent: how a number is attached to an agent (dashboard / API).
//   2. Tool calls: request shape (where the call ID, caller number and args live), auth on our
//      endpoint (shared secret header? signature?), the response shape the agent reads, and timeout.
//   3. Post-call webhook: signature header + algorithm, payload fields for call ID, caller number,
//      start/end time, duration, transcript format (turns? roles? one string?), end reason,
//      and retry behaviour.
//
// The rest of the app only uses the NormalizedInteraction / NormalizedToolCall types.

import type { NormalizedInteraction, NormalizedToolCall } from "../types";

export const PROVIDER = "vaani";

export class VaaniNotConfiguredError extends Error {
  constructor(what: string) {
    super(`Vaani adapter not implemented yet (${what}). Waiting on Vaani API docs.`);
  }
}

/** Verify the post-call webhook signature over the RAW request body. */
export function verifyWebhookSignature(_rawBody: string, _headers: Headers): boolean {
  throw new VaaniNotConfiguredError("verifyWebhookSignature");
}

/** Vaani post-call webhook JSON → NormalizedInteraction. */
export function parseCallWebhook(_payload: unknown): NormalizedInteraction {
  throw new VaaniNotConfiguredError("parseCallWebhook");
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
