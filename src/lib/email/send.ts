import { Resend } from "resend";
import { sql, sqlOne } from "../db";
import { env, envOptional } from "../env";
import { log } from "../log";
import { assertNoPriceFigures } from "../price-guard";

export interface OutgoingEmail {
  kind: string;
  /** Unique per logical email, so webhook retries / cron re-runs never double-send. */
  dedupeKey: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  callId?: string | null;
}

let resend: Resend | null = null;

export function emailTestMode(): boolean {
  return envOptional("EMAIL_TEST_MODE", "true") !== "false";
}

/**
 * Send via Resend, at most once per dedupeKey.
 * EMAIL_TEST_MODE (default ON) redirects every email to EMAIL_TEST_RECIPIENT with a [TEST] prefix.
 * Returns false if it was already sent.
 */
export async function sendEmail(email: OutgoingEmail): Promise<boolean> {
  assertNoPriceFigures(`${email.subject}\n${email.html}\n${email.text}`, `${email.kind} email`);

  const existing = await sqlOne<{ id: string; sent_at: string | null }>`select id, sent_at from emails where dedupe_key = ${email.dedupeKey}`;
  if (existing?.sent_at) return false;

  const testMode = emailTestMode();
  const to = testMode ? [envOptional("EMAIL_TEST_RECIPIENT", "delivered@resend.dev")] : email.to;
  const subject = testMode ? `[TEST → ${email.to.join(", ")}] ${email.subject}` : email.subject;

  const row = (await sqlOne<{ id: string }>`
    insert into emails (call_id, kind, dedupe_key, recipients, subject, test_mode)
    values (${email.callId ?? null}, ${email.kind}, ${email.dedupeKey}, ${email.to}::text[], ${email.subject}, ${testMode})
    on conflict (dedupe_key) do update set subject = excluded.subject
    returning id`)!;

  resend ??= new Resend(env("RESEND_API_KEY"));
  const { data, error } = await resend.emails.send(
    { from: env("RESEND_FROM"), to, subject, html: email.html, text: email.text },
    { idempotencyKey: email.dedupeKey },
  );

  if (error) {
    await sql`update emails set error = ${error.message} where id = ${row.id}`;
    throw new Error(`Resend failed for ${email.kind}: ${error.message}`);
  }

  await sql`update emails set resend_id = ${data?.id ?? null}, sent_at = now(), error = null where id = ${row.id}`;
  log.info("email.sent", { kind: email.kind, callId: email.callId, testMode });
  return true;
}
