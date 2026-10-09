// Shared handler for the live-call tool endpoints. Kept next to the adapter because it is the
// glue between Vaani's request/response shape and the provider-neutral tools.

import { FALLBACK_MESSAGE, type ToolResult } from "../tools";
import { log } from "../log";
import type { NormalizedToolCall } from "../types";
import { VaaniNotConfiguredError, parseToolCall, toToolResponse, verifyToolRequest } from "./adapter";

export async function handleToolRequest(req: Request, run: (tool: NormalizedToolCall) => Promise<ToolResult>): Promise<Response> {
  const raw = await req.text();
  try {
    if (!verifyToolRequest(raw, req.headers)) return new Response("unauthorized", { status: 401 });
    const tool = parseToolCall(JSON.parse(raw));
    const result = await run(tool);
    return Response.json(toToolResponse({ ok: result.ok, message: result.message, data: result.slots ?? result.booking }));
  } catch (err) {
    if (err instanceof VaaniNotConfiguredError) return new Response(err.message, { status: 501 });
    log.error("tool.request_failed", err);
    // Still give the agent something it can say.
    try {
      return Response.json(toToolResponse({ ok: false, message: FALLBACK_MESSAGE }));
    } catch {
      return Response.json({ ok: false, message: FALLBACK_MESSAGE });
    }
  }
}
