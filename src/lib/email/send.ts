import { Resend } from "resend";
import { db, must } from "../db";
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

  const existing = must(
    await db().from("emails").select("id, sent_at").eq("dedupe_key", email.dedupeKey).maybeSingle(),
    "emails lookup",
  );
  if (existing?.sent_at) return false;

  const testMode = emailTestMode();
  const to = testMode ? [envOptional("EMAIL_TEST_RECIPIENT", "delivered@resend.dev")] : email.to;
  const subject = testMode ? `[TEST → ${email.to.join(", ")}] ${email.subject}` : email.subject;

  const row = must(
    await db()
      .from("emails")
      .upsert(
        { call_id: email.callId ?? null, kind: email.kind, dedupe_key: email.dedupeKey, recipients: email.to, subject: email.subject, test_mode: testMode },
        { onConflict: "dedupe_key" },
      )
      .select("id")
      .single(),
    "emails upsert",
  ) as { id: string };

  resend ??= new Resend(env("RESEND_API_KEY"));
  const { data, error } = await resend.emails.send(
    { from: env("RESEND_FROM"), to, subject, html: email.html, text: email.text },
    { idempotencyKey: email.dedupeKey },
  );

  if (error) {
    await db().from("emails").update({ error: error.message }).eq("id", row.id);
    throw new Error(`Resend failed for ${email.kind}: ${error.message}`);
  }

  must(
    await db().from("emails").update({ resend_id: data?.id ?? null, sent_at: new Date().toISOString(), error: null }).eq("id", row.id),
    "emails mark sent",
  );
  log.info("email.sent", { kind: email.kind, callId: email.callId, testMode });
  return true;
}
