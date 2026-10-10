import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { env, envOptional } from "../env";
import { OUTPUT_INSTRUCTIONS, RULE_TABLE } from "./rules";
import {
  ClassificationBaseSchema,
  ClassificationSchema,
  EMPTY_FIELDS,
  type StoredClassification,
} from "./schema";

export const CONFIDENCE_THRESHOLD = 0.7;

export interface ClassifyResult {
  classification: StoredClassification;
  rawText: string;
  usage: { inputTokens: number; outputTokens: number };
}

export function geminiModel(): string {
  return envOptional("GEMINI_MODEL", "gemini-3.8-flash");
}

const SYSTEM_PROMPT = `You classify phone enquiries to Aangan Studio after the call ends.
Apply the rule table exactly. You never decide alone on a borderline call: if the rules don't settle
it, return needs_review or a low confidence.

${RULE_TABLE}

${OUTPUT_INSTRUCTIONS}`;

let ai: GoogleGenAI | null = null;

export async function classifyTranscript(transcriptText: string, callDateIst: string): Promise<ClassifyResult> {
  ai ??= new GoogleGenAI({ apiKey: env("GEMINI_API_KEY") });
  const model = geminiModel();
  const response = await ai.models.generateContent({
    model,
    contents: `Call date (IST): ${callDateIst}\n\nTRANSCRIPT\n${transcriptText}`,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      temperature: 0,
      responseMimeType: "application/json",
      responseJsonSchema: z.toJSONSchema(ClassificationBaseSchema),
    },
  });
  const rawText = response.text ?? "";
  return {
    classification: gateClassification(rawText, model),
    rawText,
    usage: {
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens:
        (response.usageMetadata?.candidatesTokenCount ?? 0) + (response.usageMetadata?.thoughtsTokenCount ?? 0),
    },
  };
}

/**
 * Validate Gemini's raw output and apply the review gate:
 * invalid JSON / schema failure / confidence < 0.7  →  outcome needs_review.
 * Pure, so the replay script can test it without network.
 */
export function gateClassification(rawText: string, model: string): StoredClassification {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return fallback(model, "Classifier returned invalid JSON");
  }

  const result = ClassificationSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    return fallback(model, `Classifier output failed validation (${issues})`, parsed);
  }

  const c = result.data;
  if (c.confidence < CONFIDENCE_THRESHOLD && c.outcome !== "needs_review") {
    return {
      ...c,
      outcome: "needs_review",
      decline_reason: null,
      classifier_outcome: c.outcome,
      review_reason: `Low classifier confidence (${c.confidence.toFixed(2)}) for "${c.outcome}"`,
      model,
    };
  }

  return {
    ...c,
    classifier_outcome: null,
    review_reason: c.outcome === "needs_review" ? reviewReasonFromFlags(c.flags) : null,
    model,
  };
}

function reviewReasonFromFlags(flags: string[]): string {
  return flags.length ? `Classifier marked for review: ${flags.join("; ")}` : "Classifier marked for review";
}

function fallback(model: string, reason: string, partial?: unknown): StoredClassification {
  // Salvage whatever fields parse so Nikhil's review email is still useful.
  const p = (partial ?? {}) as Record<string, unknown>;
  const fields = ClassificationBaseSchema.shape.fields.safeParse(p.fields);
  return {
    outcome: "needs_review",
    decline_reason: null,
    fields: fields.success ? fields.data : EMPTY_FIELDS,
    flags: Array.isArray(p.flags) ? p.flags.filter((f): f is string => typeof f === "string") : [],
    caller_quote: typeof p.caller_quote === "string" ? p.caller_quote : "",
    pricing_requested: p.pricing_requested === true,
    price_mentioned_by_agent: p.price_mentioned_by_agent === true,
    agent_violations: [],
    confidence: 0,
    classifier_outcome: null,
    review_reason: reason,
    model,
  };
}
