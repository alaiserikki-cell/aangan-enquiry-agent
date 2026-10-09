// Sample data for previewing the dashboard without a database. Enabled only when
// DASHBOARD_DEMO=true; every page using it shows a "Demo data" banner.
// Deterministic, so the preview looks the same on every load.

import type { StoredClassification } from "./classify/schema";
import { EMPTY_FIELDS } from "./classify/schema";
import type { HandoffRow, Pipeline, RangeData } from "./metrics";
import type { CallRow, Designer } from "./types";

export const isDemo = () => process.env.DASHBOARD_DEMO === "true";

const DESIGNERS: Designer[] = [
  { id: "00000000-0000-4000-8000-000000000001", name: "Designer One", email: "one@example.com", areas: ["Kothrud", "Aundh", "Baner"], active: true, calcom_event_type_id: 1, last_assigned_at: null },
  { id: "00000000-0000-4000-8000-000000000002", name: "Designer Two", email: "two@example.com", areas: ["Wakad", "Hinjewadi"], active: true, calcom_event_type_id: 2, last_assigned_at: null },
  { id: "00000000-0000-4000-8000-000000000003", name: "Designer Three", email: "three@example.com", areas: ["Kharadi", "Hadapsar", "Undri"], active: true, calcom_event_type_id: 3, last_assigned_at: null },
];

type Sample = {
  name: string | null;
  location: string;
  property: string;
  outcome: StoredClassification["outcome"];
  reason?: StoredClassification["decline_reason"];
  quote: string;
  flags: string[];
  pricing?: boolean;
  designer?: number;
};

const SAMPLES: Sample[] = [
  { name: "Priya Kulkarni", location: "Kothrud", property: "3BHK apartment", outcome: "qualified", quote: "We've just got possession and want the whole flat done properly, kitchen and wardrobes included.", flags: ["Referral from past client", "Budget not discussed"], designer: 0 },
  { name: "Rahul Shinde", location: "Wakad", property: "2BHK apartment", outcome: "qualified", quote: "I want a modern look for the living room and both bedrooms.", flags: ["Asked for pricing twice; expects a number at consultation", "Decision-maker not confirmed"], pricing: true, designer: 1 },
  { name: "Suresh Patil", location: "Nashik", property: "Home office", outcome: "declined", reason: "out_of_area", quote: "I need my home office set up in Nashik.", flags: [] },
  { name: "Anjali Mehta", location: "Baner", property: "2BHK apartment", outcome: "declined", reason: "advice_only", quote: "Just looking for some colour and furniture ideas for now.", flags: ["May return later for a full project"] },
  { name: "Kavita Joshi", location: "Aundh", property: "Living room + kitchen", outcome: "declined", reason: "timeline", quote: "We need the living room and kitchen ready before Diwali.", flags: ["Offered November start; caller undecided, re-engage"] },
  { name: "Sheetal Deshpande", location: "Viman Nagar", property: "2BHK apartment", outcome: "existing_client", quote: "Our designer hasn't replied in a week and work has stopped.", flags: ["Wants callback from Nikhil or senior person", "Designer: Aryan"] },
  { name: "Amit Rao", location: "Aundh", property: "3BHK apartment", outcome: "qualified", quote: "Full home interiors, we move in around February.", flags: ["Pushed hard for a ballpark", "Decision-maker not confirmed"], pricing: true, designer: 0 },
  { name: "Nikhil Gokhale", location: "Hadapsar", property: "3BHK apartment", outcome: "qualified", quote: "I'm calling for my parents, they want their new flat done.", flags: ["Caller is son; owners are parents and will decide", "Parents attend consultation"], designer: 2 },
  { name: "Smita Pawar", location: "Undri", property: "2BHK apartment", outcome: "qualified", quote: "Possession is in six weeks and I'd like to start the design now.", flags: ["Possession in ~6 weeks; builder allows site access now"], designer: 2 },
  { name: "Rohan Desai", location: "Baner", property: "Coworking pod, 180 sq ft", outcome: "needs_review", quote: "I have a small coworking pod I want fitted out.", flags: ["Very small commercial space; confirm fit"] },
  { name: "Farhan Shaikh", location: "Koregaon Park", property: "Restaurant", outcome: "declined", reason: "out_of_scope_type", quote: "We're opening a restaurant and need the interiors.", flags: [] },
  { name: null, location: "", property: "", outcome: "dropped", quote: "", flags: [] },
  { name: "Vendor call", location: "", property: "", outcome: "not_a_lead", quote: "We supply laminates and wanted to meet your purchase team.", flags: [] },
  { name: "Neha Bhosale", location: "Kharadi", property: "1BHK apartment", outcome: "declined", reason: "budget_mismatch", quote: "Just the kitchen and one bedroom, on a tight budget.", flags: [] },
];

const TRANSCRIPT = [
  { role: "agent" as const, text: "Hello, thank you for calling Aangan Studio. How can I help you today?" },
  { role: "caller" as const, text: "Hi, we've just bought a flat and want to get the interiors done." },
  { role: "agent" as const, text: "Lovely. Where is the property?" },
  { role: "caller" as const, text: "Kothrud. It's a 3BHK, about 1,400 square feet carpet." },
  { role: "agent" as const, text: "When would you need the project complete?" },
  { role: "caller" as const, text: "By March, ideally. Roughly how much would that cost?" },
  { role: "agent" as const, text: "Pricing depends on the site, the materials you choose, and the scope. Your designer will walk you through it in detail at the consultation. I can book that for you right now if you'd like." },
  { role: "caller" as const, text: "Okay, yes, let's book it." },
];

function build(): { calls: CallRow[]; handoffs: HandoffRow[] } {
  const now = Date.now();
  const calls: CallRow[] = [];
  const handoffs: HandoffRow[] = [];
  // ~6 weeks of calls (so period-over-period deltas have history), newest first; several today.
  for (let i = 0; i < 96; i++) {
    const s = SAMPLES[(i * 5) % SAMPLES.length];
    const hoursAgo = i < 5 ? i * 1.7 + 0.3 : 6 + i * 11.3;
    const start = new Date(now - hoursAgo * 3600e3);
    const duration = s.outcome === "dropped" ? 35 : 180 + ((i * 47) % 260);
    const end = new Date(start.getTime() + duration * 1000);
    const id = `00000000-0000-4000-9000-${String(i).padStart(12, "0")}`;
    const designer = s.designer != null ? DESIGNERS[s.designer] : null;
    const booked = s.outcome === "qualified" && i % 9 !== 4;
    const c: StoredClassification = {
      outcome: s.outcome,
      decline_reason: s.reason ?? null,
      fields: { ...EMPTY_FIELDS, name: s.name, location: s.location || null, property_type: s.property || null, decision_maker_confirmed: !s.flags.some((f) => f.includes("not confirmed")) },
      flags: s.flags,
      caller_quote: s.quote,
      pricing_requested: !!s.pricing,
      price_mentioned_by_agent: false,
      confidence: s.outcome === "needs_review" ? 0.62 : 0.9,
      classifier_outcome: null,
      review_reason: s.outcome === "needs_review" ? "Very small commercial space; confirm fit" : null,
      model: "demo",
    };
    calls.push({
      id,
      channel: "phone",
      provider: "vaani",
      external_id: `demo-${i}`,
      status: "processed",
      processing_attempts: 1,
      processing_error: null,
      raw_payload: null,
      caller_phone: `+91 98${String(10000000 + i * 7919).slice(0, 8)}`,
      started_at: start.toISOString(),
      ended_at: end.toISOString(),
      duration_seconds: duration,
      transcript: TRANSCRIPT,
      outcome: s.outcome,
      decline_reason: s.reason ?? null,
      review_reason: c.review_reason,
      classification: c,
      classified_at: end.toISOString(),
      designer_id: designer?.id ?? null,
      booking_status: s.outcome === "qualified" ? (booked ? "booked" : "booking_failed") : "none",
      booking_start: booked ? new Date(now + (2 + (i % 5)) * 864e5).toISOString() : null,
      booking_uid: null,
      consultation_mode: booked ? (i % 2 ? "home" : "studio") : null,
      vaani_minutes: duration / 60,
      gemini_input_tokens: 2400 + i * 13,
      gemini_output_tokens: 380,
      callback_done_at: null,
      created_at: start.toISOString(),
      updated_at: end.toISOString(),
    });
    if (designer) {
      const sent = new Date(end.getTime() + (40 + (i % 6) * 15) * 1000);
      const acked = i % 7 === 0 ? null : new Date(sent.getTime() + (8 + (i % 5) * 19) * 60e3);
      handoffs.push({ call_id: id, designer_id: designer.id, email_sent_at: sent.toISOString(), acknowledged_at: acked && acked.getTime() < now ? acked.toISOString() : null, escalated_at: null });
    }
  }
  return { calls, handoffs };
}

export function demoRange(start: Date, end: Date): RangeData {
  const { calls, handoffs } = build();
  const inRange = calls.filter((c) => c.created_at >= start.toISOString() && c.created_at < end.toISOString());
  const ids = new Set(inRange.map((c) => c.id));
  return { calls: inRange, handoffs: handoffs.filter((h) => ids.has(h.call_id)), incidents: [], emailsSent: Math.round(inRange.length * 1.6) };
}

export function demoCall(id: string): CallRow | null {
  return build().calls.find((c) => c.id === id) ?? null;
}

export function demoHandoff(id: string): HandoffRow | null {
  return build().handoffs.find((h) => h.call_id === id) ?? null;
}

export const demoPipeline = (): Pipeline => ({ openDeals: 11, wonDeals: 2, wonValue: null, lastSyncedAt: new Date(Date.now() - 22 * 60e3).toISOString() });
export const demoCallbacks = (): CallRow[] => build().calls.filter((c) => c.outcome === "dropped").slice(0, 3);
export const demoDesigners = () => new Map(DESIGNERS.map((d) => [d.id, d]));
