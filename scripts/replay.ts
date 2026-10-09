/**
 * Replay test transcripts through classification + routing without a phone call.
 *
 *   npm run replay            real Gemini on tests/fixtures/transcripts/*.txt (needs GEMINI_API_KEY)
 *   npm run replay -- --stub  no network: builds the classifier output from expected.json and
 *                             checks the gate, routing plan, emails and price guard
 *   npm run replay -- T07     only the listed case(s)
 *
 * No database, HubSpot, Cal.com or Resend calls are made in either mode. Routing is checked
 * on the pure action plan, and every email that plan would send is rendered and run
 * through the price guard. Exits 1 on any mismatch.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CONFIDENCE_THRESHOLD, classifyTranscript, gateClassification, geminiModel } from "../src/lib/classify/gemini";
import { EMPTY_FIELDS, type StoredClassification } from "../src/lib/classify/schema";
import { complianceEmail, existingClientEmail, formatPhone, handoffEmail, needsReviewEmail } from "../src/lib/email/templates";
import { assertSafeToSend, findPriceFigures, findSensitiveIds } from "../src/lib/price-guard";
import { dealDescription } from "../src/lib/route/process-call";
import { planActions, type Action } from "../src/lib/route/plan";
import type { TranscriptTurn } from "../src/lib/types";
import { transcriptToText } from "../src/lib/types";

interface Case {
  id: string;
  summary: string;
  callDate: string;
  booked: boolean;
  outcome: string;
  decline_reason: string | null;
  pricing_requested: boolean;
  flags: string[];
}

const ROOT = join(__dirname, "..");
const FIXTURES = join(ROOT, "tests", "fixtures");
const args = process.argv.slice(2);
const STUB = args.includes("--stub");
const only = args.filter((a) => /^T\d+$/i.test(a)).map((a) => a.toUpperCase());

const RED = "\x1b[31m", GREEN = "\x1b[32m", YELLOW = "\x1b[33m", DIM = "\x1b[2m", RESET = "\x1b[0m";
const failures: string[] = [];

function check(label: string, ok: boolean, detail: string) {
  if (!ok) failures.push(`${label}: ${detail}`);
  console.log(`  ${ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`} ${label}${ok ? `${DIM} ${detail}${RESET}` : ` ${RED}${detail}${RESET}`}`);
}

function parseTranscript(text: string): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(agent|caller|vaani|assistant|customer|user)\s*:\s*(.*)$/i);
    if (m) turns.push({ role: /^(agent|vaani|assistant)$/i.test(m[1]) ? "agent" : "caller", text: m[2].trim() });
    else if (line.trim() && turns.length) turns.at(-1)!.text += ` ${line.trim()}`;
  }
  return turns;
}

function expectedActions(c: Case): Action["type"][] {
  switch (c.outcome) {
    case "qualified":
      return ["designer_handoff", "hubspot_deal"];
    case "existing_client":
      return ["urgent_existing_client"];
    case "needs_review":
      return c.booked ? ["needs_review_email", "designer_handoff"] : ["needs_review_email"];
    case "dropped":
      return ["callback_list"];
    default:
      return [];
  }
}

function stubClassification(c: Case): StoredClassification {
  return {
    outcome: c.outcome as StoredClassification["outcome"],
    decline_reason: c.decline_reason as StoredClassification["decline_reason"],
    fields: { ...EMPTY_FIELDS, name: `Caller ${c.id}`, location: "Pune", property_type: "Apartment" },
    flags: c.flags,
    caller_quote: c.summary,
    pricing_requested: c.pricing_requested,
    price_mentioned_by_agent: false,
    agent_violations: [],
    confidence: 0.95,
    classifier_outcome: null,
    review_reason: c.outcome === "needs_review" ? "stub" : null,
    model: "stub",
  };
}

/** Render every email this plan would send and run the price guard over it. */
function renderAndGuard(actions: Action[], c: StoredClassification, booked: boolean) {
  const url = "https://example.test/dashboard/calls/x";
  const rendered: { name: string; text: string }[] = [];
  for (const a of actions) {
    if (a.type === "designer_handoff") {
      const e = handoffEmail({ c, callerPhone: "+910000000000", designerName: "Designer One", bookingStatus: booked ? "booked" : "none", bookingStart: booked ? "2026-10-10T05:30:00Z" : null, consultationMode: "home", ackUrl: url, transcriptUrl: url, pendingReview: a.pendingReview });
      rendered.push({ name: "handoff", text: `${e.subject}\n${e.html}\n${e.text}` });
    }
    if (a.type === "hubspot_deal") rendered.push({ name: "deal", text: dealDescription(c, booked ? "2026-10-10T05:30:00Z" : null, "Designer One") });
    if (a.type === "urgent_existing_client") {
      const e = existingClientEmail({ c, callerPhone: null, transcriptUrl: url, endedAt: null });
      rendered.push({ name: "urgent", text: `${e.subject}\n${e.html}\n${e.text}` });
    }
    if (a.type === "needs_review_email") {
      const e = needsReviewEmail({ c, callerPhone: null, transcriptUrl: url, reason: a.reason, bookingStart: null, designerName: null });
      rendered.push({ name: "review", text: `${e.subject}\n${e.html}\n${e.text}` });
    }
    if (a.type === "compliance_incident") {
      const e = complianceEmail({ callId: "x", transcriptUrl: url, endedAt: null });
      rendered.push({ name: "compliance", text: `${e.subject}\n${e.html}\n${e.text}` });
    }
  }
  for (const r of rendered) {
    let hits: string[] = [];
    try {
      assertSafeToSend(r.text, r.name);
    } catch {
      hits = findPriceFigures(r.text.replaceAll("[amount withheld]", ""));
    }
    check(`no price figure in ${r.name}`, hits.length === 0, hits.length ? `found ${JSON.stringify(hits)}` : "clean");
  }
}

function selfTests() {
  console.log(`\n${YELLOW}Self-tests (gate + price guard)${RESET}`);
  const bad = gateClassification("not json", "m");
  check("invalid JSON → needs_review", bad.outcome === "needs_review", bad.review_reason ?? "");
  const low = gateClassification(
    JSON.stringify({ outcome: "qualified", decline_reason: null, fields: EMPTY_FIELDS, flags: [], caller_quote: "x", pricing_requested: false, price_mentioned_by_agent: false, confidence: CONFIDENCE_THRESHOLD - 0.01 }),
    "m",
  );
  check("confidence < 0.7 → needs_review", low.outcome === "needs_review" && low.classifier_outcome === "qualified", low.review_reason ?? "");
  const noReason = gateClassification(
    JSON.stringify({ outcome: "declined", decline_reason: null, fields: EMPTY_FIELDS, flags: [], caller_quote: "x", pricing_requested: false, price_mentioned_by_agent: false, confidence: 0.9 }),
    "m",
  );
  check("declined without reason → needs_review", noReason.outcome === "needs_review", noReason.review_reason ?? "");
  for (const s of ["₹1 to 1.5 lakh", "Rs. 500000", "1800 per sq ft", "2,000/sqft", "around 5 lakhs", "8-10 lacs", "15 L"]) {
    check(`guard catches "${s}"`, findPriceFigures(s).length > 0, "");
  }
  for (const s of ["1,400 sq ft 3BHK", "Sat 10 Oct, 11:00 am", "+91 98220 12345", "done by March 2027"]) {
    check(`guard allows "${s}"`, findPriceFigures(s).length === 0, "");
  }
  for (const s of ["my aadhaar is 2345 6789 0123", "PAN ABCDE1234F", "card 4111 1111 1111 1111"]) {
    check(`ID guard catches "${s}"`, findSensitiveIds(s).length > 0, "");
  }
  for (const s of ["+91 98220 12345", "+919822012345", "call 9822012345", "1,400 sq ft, 3BHK, March 2027"]) {
    check(`ID guard allows "${s}"`, findSensitiveIds(s).length === 0, findSensitiveIds(s).join(","));
  }
  check("12-digit phone formatted safely", findSensitiveIds(formatPhone("919822012345")).length === 0, formatPhone("919822012345"));
  const policyCase = stubClassification({ id: "Y", summary: "y", callDate: "", booked: false, outcome: "declined", decline_reason: "out_of_area", pricing_requested: false, flags: [] });
  policyCase.agent_violations = ["guaranteed_date"];
  check("agent policy breach → policy incident", planActions({ c: policyCase, bookingStatus: "none", callerPhone: null }).some((a) => a.type === "policy_incident"), "");
  const priceCase = stubClassification({ id: "X", summary: "x", callDate: "", booked: true, outcome: "qualified", decline_reason: null, pricing_requested: true, flags: [] });
  priceCase.price_mentioned_by_agent = true;
  check("agent price mention → compliance incident", planActions({ c: priceCase, bookingStatus: "booked", callerPhone: null })[0]?.type === "compliance_incident", "");
}

async function main() {
  const { cases } = JSON.parse(readFileSync(join(FIXTURES, "expected.json"), "utf8")) as { cases: Case[] };
  const selected = only.length ? cases.filter((c) => only.includes(c.id)) : cases;
  console.log(`Replaying ${selected.length} case(s) · mode: ${STUB ? "STUB (no Gemini)" : `Gemini ${geminiModel()}`}`);

  selfTests();

  const tally: Record<string, number> = {};
  for (const tc of selected) {
    console.log(`\n${YELLOW}${tc.id}${RESET} ${tc.summary}`);
    let c: StoredClassification;
    if (STUB) {
      c = stubClassification(tc);
    } else {
      const path = join(FIXTURES, "transcripts", `${tc.id}.txt`);
      if (!existsSync(path)) {
        check("transcript present", false, `missing ${path}`);
        continue;
      }
      const turns = parseTranscript(readFileSync(path, "utf8"));
      if (!turns.length) {
        check("transcript parsed", false, "no Agent:/Caller: lines found");
        continue;
      }
      const res = await classifyTranscript(transcriptToText(turns), tc.callDate);
      c = res.classification;
      console.log(`  ${DIM}confidence ${c.confidence.toFixed(2)} · tokens ${res.usage.inputTokens}/${res.usage.outputTokens}${c.review_reason ? ` · review: ${c.review_reason}` : ""}${RESET}`);
    }

    tally[c.outcome] = (tally[c.outcome] ?? 0) + 1;
    check("outcome", c.outcome === tc.outcome, `expected ${tc.outcome}, got ${c.outcome}`);
    check("decline_reason", c.decline_reason === tc.decline_reason, `expected ${tc.decline_reason}, got ${c.decline_reason}`);
    check("pricing_requested", c.pricing_requested === tc.pricing_requested, `expected ${tc.pricing_requested}, got ${c.pricing_requested}`);
    check("price_mentioned_by_agent is false", c.price_mentioned_by_agent === false, c.price_mentioned_by_agent ? "got true (COMPLIANCE FAILURE)" : "got false");

    check("no agent policy violations", c.agent_violations.length === 0, c.agent_violations.length ? `got ${c.agent_violations.join(", ")} (AGENT POLICY FAILURE)` : "none");

    // Flags are free text: shown side by side, not failed on.
    console.log(`  ${DIM}flags expected: ${JSON.stringify(tc.flags)}${RESET}`);
    console.log(`  ${DIM}flags actual:   ${JSON.stringify(c.flags)}${RESET}`);

    const plan = planActions({ c, bookingStatus: tc.booked ? "booked" : "none", callerPhone: "+910000000000" });
    const got = plan.map((a) => a.type);
    const want = expectedActions(tc);
    check("routing", JSON.stringify(got) === JSON.stringify(want), `expected [${want.join(", ")}], got [${got.join(", ")}]`);
    if (tc.outcome === "existing_client") {
      check("no HubSpot deal / designer handoff", !got.includes("hubspot_deal") && !got.includes("designer_handoff"), got.join(", ") || "none");
    }
    renderAndGuard(plan, c, tc.booked);
  }

  console.log(`\nOutcome tally: ${JSON.stringify(tally)}`);
  if (failures.length) {
    console.error(`\n${RED}✗ ${failures.length} FAILURE(S)${RESET}`);
    for (const f of failures) console.error(`  ${RED}- ${f}${RESET}`);
    process.exit(1);
  }
  console.log(`\n${GREEN}✓ All checks passed${RESET}`);
}

main().catch((err) => {
  console.error(`${RED}Replay crashed:${RESET}`, err);
  process.exit(1);
});
