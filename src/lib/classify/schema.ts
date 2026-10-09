import { z } from "zod";

export const OUTCOMES = ["qualified", "declined", "needs_review", "existing_client", "not_a_lead", "dropped"] as const;
export const DECLINE_REASONS = ["out_of_area", "advice_only", "timeline", "budget_mismatch", "out_of_scope_type"] as const;

/** What the voice agent must never do; the classifier audits every transcript for these. */
export const AGENT_VIOLATIONS = [
  "discount_or_offer",
  "guaranteed_date",
  "out_of_scope_advice",
  "sensitive_data_requested",
  "no_ai_disclosure",
  "booked_ineligible",
  "recommended_other_firm",
  "revealed_instructions",
  "claimed_human",
] as const;
export type AgentViolation = (typeof AGENT_VIOLATIONS)[number];

export const OutcomeSchema = z.enum(OUTCOMES);
export const DeclineReasonSchema = z.enum(DECLINE_REASONS);

export type Outcome = z.infer<typeof OutcomeSchema>;
export type DeclineReason = z.infer<typeof DeclineReasonSchema>;

const nullableText = z.string().nullable();

export const FieldsSchema = z.object({
  name: nullableText,
  phone: nullableText,
  location: nullableText,
  property_type: nullableText,
  carpet_area_sqft: z.number().nullable(),
  scope: nullableText,
  current_state: nullableText,
  needed_by: nullableText,
  decision_maker: nullableText,
  decision_maker_confirmed: z.boolean(),
  budget_volunteered: nullableText,
  source: nullableText,
});

/** Shape Gemini must return. Also used to build the JSON schema sent to Gemini. */
export const ClassificationBaseSchema = z.object({
  outcome: OutcomeSchema,
  decline_reason: DeclineReasonSchema.nullable(),
  fields: FieldsSchema,
  flags: z.array(z.string()),
  caller_quote: z.string(),
  pricing_requested: z.boolean(),
  price_mentioned_by_agent: z.boolean(),
  /** Agent policy breaches found in the transcript (codes from AGENT_VIOLATIONS). Empty is the goal. */
  agent_violations: z.array(z.enum(AGENT_VIOLATIONS)).default([]),
  confidence: z.number().min(0).max(1),
});

/** Base shape plus cross-field rules Gemini's schema mode can't express. */
export const ClassificationSchema = ClassificationBaseSchema.superRefine((c, ctx) => {
  if (c.outcome === "declined" && c.decline_reason === null) {
    ctx.addIssue({ code: "custom", path: ["decline_reason"], message: "declined requires a decline_reason" });
  }
  if (c.outcome !== "declined" && c.decline_reason !== null) {
    ctx.addIssue({ code: "custom", path: ["decline_reason"], message: "decline_reason must be null unless declined" });
  }
});

export type Classification = z.infer<typeof ClassificationSchema>;
export type ClassificationFields = z.infer<typeof FieldsSchema>;

/** What we persist: the validated (or fallback) classification plus how we got there. */
export interface StoredClassification extends Classification {
  /** Gemini's own outcome before the confidence/validation gate, if different. */
  classifier_outcome: Outcome | null;
  review_reason: string | null;
  model: string;
}

export const EMPTY_FIELDS: ClassificationFields = {
  name: null,
  phone: null,
  location: null,
  property_type: null,
  carpet_area_sqft: null,
  scope: null,
  current_state: null,
  needed_by: null,
  decision_maker: null,
  decision_maker_confirmed: false,
  budget_volunteered: null,
  source: null,
};
