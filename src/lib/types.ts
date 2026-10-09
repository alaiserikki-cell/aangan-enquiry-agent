// Provider-neutral shapes. Nothing outside src/lib/vaani/ may depend on Vaani's payloads;
// the adapter converts to these. A future WhatsApp / web-form adapter produces the same shape.

export type Channel = "phone" | "whatsapp" | "web_form";

export interface TranscriptTurn {
  role: "agent" | "caller";
  text: string;
}

/** A finished interaction, normalised from whatever the provider sent. */
export interface NormalizedInteraction {
  channel: Channel;
  provider: string;
  externalId: string;
  callerPhone: string | null;
  startedAt: string | null; // ISO
  endedAt: string | null; // ISO
  durationSeconds: number | null;
  transcript: TranscriptTurn[];
}

/** A tool call made by the voice agent mid-conversation. */
export interface NormalizedToolCall {
  externalCallId: string | null;
  callerPhone: string | null;
  args: Record<string, unknown>;
}

export interface Designer {
  id: string;
  name: string;
  email: string;
  areas: string[];
  active: boolean;
  calcom_event_type_id: number | null;
  last_assigned_at: string | null;
}

export interface CallRow {
  id: string;
  channel: Channel;
  provider: string;
  external_id: string;
  status: "in_call" | "received" | "processing" | "processed" | "failed";
  processing_attempts: number;
  processing_error: string | null;
  raw_payload: unknown;
  caller_phone: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  transcript: TranscriptTurn[] | null;
  outcome: string | null;
  decline_reason: string | null;
  review_reason: string | null;
  classification: unknown;
  classified_at: string | null;
  designer_id: string | null;
  booking_status: "none" | "booked" | "booking_failed";
  booking_uid: string | null;
  booking_start: string | null;
  consultation_mode: "home" | "studio" | null;
  vaani_minutes: number | null;
  gemini_input_tokens: number;
  gemini_output_tokens: number;
  callback_done_at: string | null;
  created_at: string;
  updated_at: string;
}

export function transcriptToText(turns: TranscriptTurn[]): string {
  return turns.map((t) => `${t.role === "agent" ? "Agent" : "Caller"}: ${t.text}`).join("\n");
}
