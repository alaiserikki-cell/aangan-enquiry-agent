"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { json, sql, sqlOne } from "@/lib/db";
import { processCall } from "@/lib/route/process-call";
import { requireSession } from "@/lib/require-session";
import { SCENARIOS, parseSimTranscript } from "@/lib/sim-scenarios";

const MAX_TRANSCRIPT_CHARS = 20_000;

/**
 * Free test run: push a transcript through the same pipeline a real Vaani call uses
 * (classification, routing, test-mode emails, dashboard), with no Vaani minutes spent.
 * Rows are stored with provider 'simulator' so they're labelled everywhere and never
 * counted as Vaani cost.
 */
export async function runSimulation(formData: FormData) {
  await requireSession();

  const scenario = SCENARIOS.find((s) => s.id === String(formData.get("scenario") ?? ""));
  const pasted = String(formData.get("transcript") ?? "").slice(0, MAX_TRANSCRIPT_CHARS);
  const text = scenario?.transcript ?? pasted;
  const turns = parseSimTranscript(text);
  if (turns.length < 2) redirect("/dashboard/test?error=transcript");

  const phone = scenario?.phone ?? null;
  const durationSeconds = Math.max(30, turns.length * 12);
  const ended = new Date();
  const started = new Date(ended.getTime() - durationSeconds * 1000);

  const row = (await sqlOne<{ id: string }>`
    insert into calls (provider, channel, external_id, status, caller_phone, started_at, ended_at, duration_seconds, transcript, raw_payload)
    values ('simulator', 'phone', ${`sim-${randomUUID()}`}, 'received', ${phone}, ${started.toISOString()}, ${ended.toISOString()},
            ${durationSeconds}, ${json(turns)}::jsonb, ${json({ simulated: true, scenario: scenario?.id ?? "custom" })}::jsonb)
    returning id`)!;

  await processCall(row.id);

  const q = new URLSearchParams({ sim: "1" });
  if (scenario) {
    q.set("expected", scenario.expected);
    if (scenario.expectedReason) q.set("reason", scenario.expectedReason);
    q.set("scenario", scenario.id);
  }
  redirect(`/dashboard/calls/${row.id}?${q}`);
}

/** Remove every simulated call (and, by cascade, its emails, handoffs and incidents rows). */
export async function clearSimulations() {
  await requireSession();
  await sql`delete from calls where provider = 'simulator'`;
  redirect("/dashboard/test?cleared=1");
}
