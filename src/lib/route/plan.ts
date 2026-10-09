// Pure routing: classification + booking state → list of actions.
// The replay script asserts on this plan; execute.ts carries it out.

import type { StoredClassification } from "../classify/schema";

export type Action =
  | { type: "compliance_incident" }
  | { type: "policy_incident"; violations: string[] }
  | { type: "hubspot_deal" }
  | { type: "designer_handoff"; pendingReview: boolean }
  | { type: "urgent_existing_client" }
  | { type: "needs_review_email"; reason: string }
  | { type: "callback_list" };

export interface PlanInput {
  c: StoredClassification;
  bookingStatus: "none" | "booked" | "booking_failed";
  callerPhone: string | null;
}

export function planActions({ c, bookingStatus, callerPhone }: PlanInput): Action[] {
  const actions: Action[] = [];

  if (c.price_mentioned_by_agent) actions.push({ type: "compliance_incident" });
  if (c.agent_violations?.length) actions.push({ type: "policy_incident", violations: c.agent_violations });

  switch (c.outcome) {
    case "qualified":
      // Handoff first: the two-minute target matters more than CRM entry.
      actions.push({ type: "designer_handoff", pendingReview: false }, { type: "hubspot_deal" });
      break;
    case "existing_client":
      actions.push({ type: "urgent_existing_client" });
      break;
    case "needs_review":
      actions.push({ type: "needs_review_email", reason: c.review_reason ?? "Marked for review" });
      // The agent already booked a slot: tell the designer now (marked pending review) so the
      // appointment isn't missed. No HubSpot deal until Nikhil decides.
      if (bookingStatus !== "none") actions.push({ type: "designer_handoff", pendingReview: true });
      break;
    case "dropped":
      if (callerPhone || c.fields.phone) actions.push({ type: "callback_list" });
      break;
    case "declined":
    case "not_a_lead":
      break;
  }
  return actions;
}
