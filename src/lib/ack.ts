import { createHash, randomBytes } from "node:crypto";
import { db, must } from "./db";
import { appUrl } from "./env";

export const ACK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newAckToken(): { token: string; hash: string; expiresAt: Date } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token), expiresAt: new Date(Date.now() + ACK_TTL_MS) };
}

export function ackUrl(token: string): string {
  return `${appUrl()}/api/ack/${token}`;
}

export type AckResult =
  | { status: "acknowledged"; leadName: string | null }
  | { status: "already"; acknowledgedAt: string }
  | { status: "expired" }
  | { status: "invalid" };

/** Single-use: the conditional update only succeeds once. */
export async function acknowledge(token: string): Promise<AckResult> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return { status: "invalid" };
  const hash = hashToken(token);
  const now = new Date().toISOString();

  const updated = must(
    await db()
      .from("handoffs")
      .update({ acknowledged_at: now })
      .eq("ack_token", hash)
      .is("acknowledged_at", null)
      .gt("ack_expires_at", now)
      .select("call_id, calls(classification)")
      .maybeSingle(),
    "ack update",
  ) as { call_id: string; calls: { classification: { fields?: { name?: string | null } } | null } | null } | null;

  if (updated) return { status: "acknowledged", leadName: updated.calls?.classification?.fields?.name ?? null };

  const existing = must(
    await db().from("handoffs").select("acknowledged_at, ack_expires_at").eq("ack_token", hash).maybeSingle(),
    "ack lookup",
  ) as { acknowledged_at: string | null; ack_expires_at: string } | null;

  if (!existing) return { status: "invalid" };
  if (existing.acknowledged_at) return { status: "already", acknowledgedAt: existing.acknowledged_at };
  return { status: "expired" };
}
