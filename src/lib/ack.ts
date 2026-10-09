import { createHash, randomBytes } from "node:crypto";
import { sqlOne } from "./db";
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

  const updated = await sqlOne<{ lead_name: string | null }>`
    update handoffs h set acknowledged_at = now()
    from calls c
    where c.id = h.call_id and h.ack_token = ${hash} and h.acknowledged_at is null and h.ack_expires_at > now()
    returning c.classification->'fields'->>'name' as lead_name`;
  if (updated) return { status: "acknowledged", leadName: updated.lead_name };

  const existing = await sqlOne<{ acknowledged_at: string | null }>`select acknowledged_at from handoffs where ack_token = ${hash}`;
  if (!existing) return { status: "invalid" };
  if (existing.acknowledged_at) return { status: "already", acknowledgedAt: existing.acknowledged_at };
  return { status: "expired" };
}
