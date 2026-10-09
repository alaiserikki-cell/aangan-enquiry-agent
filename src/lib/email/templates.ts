// Pure email renderers: data in, { subject, html, text } out. No network, so the replay script
// can render every email and run the price guard over it.
// Every caller-derived string goes through clean() = redactPrices + HTML escape.

import type { StoredClassification } from "../classify/schema";
import { redactPrices } from "../price-guard";
import { formatDuration, formatIst } from "../time";

export interface Rendered {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const safe = (s: string | null | undefined): string => redactPrices(s ?? "");
const clean = (s: string | null | undefined): string => escapeHtml(safe(s));

const BRAND = "#7a4b2a";

function layout(title: string, body: string): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f6f3ef;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#2b2420">
<div style="max-width:640px;margin:0 auto;padding:16px">
<div style="background:#fff;border-radius:8px;padding:20px;border:1px solid #e7e0d8">
<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${BRAND};margin-bottom:8px">Aangan Studio · ${escapeHtml(title)}</div>
${body}
</div></div></body></html>`;
}

function fieldTable(rows: [string, string][]): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
${rows
  .map(
    ([k, v]) =>
      `<tr><td style="padding:8px 10px;border-bottom:1px solid #eee;color:#6b625b;width:38%;vertical-align:top">${escapeHtml(k)}</td><td style="padding:8px 10px;border-bottom:1px solid #eee;vertical-align:top">${v || "<span style='color:#aaa'>–</span>"}</td></tr>`,
  )
  .join("\n")}
</table>`;
}

function flagBox(flags: string[]): string {
  if (!flags.length) return "";
  return `<div style="background:#fff6e0;border:1px solid #f0d48a;border-radius:6px;padding:12px 14px;margin:16px 0">
<div style="font-weight:600;margin-bottom:6px">Flags</div>
<ul style="margin:0;padding-left:18px">${flags.map((f) => `<li>${clean(f)}</li>`).join("")}</ul></div>`;
}

function button(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;background:${BRAND};color:#fff;text-decoration:none;font-weight:600;padding:14px 28px;border-radius:6px;font-size:16px">${escapeHtml(label)}</a>`;
}

function link(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" style="color:${BRAND}">${escapeHtml(label)}</a>`;
}

/** The designer never sees the caller's figure; they see that a budget was mentioned. */
function budgetCell(budget: string | null): string {
  return budget ? "Mentioned by caller (amount withheld; see transcript)" : "Not discussed";
}

function fieldRows(c: StoredClassification, callerPhone: string | null): [string, string][] {
  const f = c.fields;
  return [
    ["Name", clean(f.name)],
    ["Phone", clean(f.phone || callerPhone)],
    ["Location", clean(f.location)],
    ["Property type", clean(f.property_type)],
    ["Carpet area", f.carpet_area_sqft != null ? `${f.carpet_area_sqft} sq ft` : ""],
    ["Scope", clean(f.scope)],
    ["Current state", clean(f.current_state)],
    ["Needed by", clean(f.needed_by)],
    ["Decision-maker", clean(f.decision_maker)],
    ["Decision-maker confirmed", f.decision_maker_confirmed ? "Yes" : "No"],
    ["Budget", escapeHtml(budgetCell(f.budget_volunteered))],
    ["Source", clean(f.source)],
    ["Asked about pricing", c.pricing_requested ? "Yes" : "No"],
  ];
}

function fieldText(c: StoredClassification, callerPhone: string | null): string {
  return fieldRows(c, callerPhone)
    .map(([k, v]) => `${k}: ${v.replace(/<[^>]+>/g, "") || "–"}`)
    .join("\n");
}

function displayName(c: StoredClassification): string {
  return safe(c.fields.name) || "Unknown caller";
}

// ---------------------------------------------------------------------------

export interface HandoffInput {
  c: StoredClassification;
  callerPhone: string | null;
  designerName: string;
  bookingStatus: "none" | "booked" | "booking_failed";
  bookingStart: string | null;
  consultationMode: "home" | "studio" | null;
  ackUrl: string;
  transcriptUrl: string;
  pendingReview: boolean;
}

export function handoffEmail(i: HandoffInput): Rendered {
  const name = displayName(i.c);
  const prop = safe(i.c.fields.property_type) || "Project";
  const loc = safe(i.c.fields.location) || "location unknown";
  const when = i.bookingStart ? formatIst(i.bookingStart) : null;

  const tag =
    i.bookingStatus === "booked" && when
      ? `New lead · consultation booked ${when}`
      : i.bookingStatus === "booking_failed"
        ? "New lead · BOOKING FAILED, call back within 2 hours"
        : "New lead · no consultation booked yet";
  const subject = `[${tag}]${i.pendingReview ? " [Pending review]" : ""} ${name}, ${prop} in ${loc}`;

  const bookingHtml =
    i.bookingStatus === "booked" && when
      ? `<p style="margin:0"><strong>${escapeHtml(when)}</strong> IST · ${i.consultationMode === "home" ? "At the client's home" : i.consultationMode === "studio" ? "At the studio" : "Venue not set"} · with ${escapeHtml(i.designerName)}</p>`
      : i.bookingStatus === "booking_failed"
        ? `<p style="margin:0;color:#a3281f"><strong>Booking failed during the call.</strong> The caller was told a designer would call within two hours to fix a time. Please call them now.</p>`
        : `<p style="margin:0">No slot was booked on the call. Please call the client to fix a consultation.</p>`;

  const reviewNote = i.pendingReview
    ? `<p style="background:#fdecea;border-radius:6px;padding:10px 12px;margin:12px 0">This call is also with Nikhil for review. Keep the appointment unless you hear otherwise.</p>`
    : "";

  const html = layout(
    "New lead",
    `<blockquote style="margin:0 0 8px;padding:12px 16px;border-left:4px solid ${BRAND};background:#faf7f3;font-size:17px;font-style:italic">“${clean(i.c.caller_quote) || "No quote captured"}”</blockquote>
${reviewNote}
${fieldTable(fieldRows(i.c, i.callerPhone))}
${flagBox(i.c.flags)}
<h3 style="margin:20px 0 6px;font-size:15px">Booking</h3>
${bookingHtml}
<div style="text-align:center;margin:28px 0 12px">${button(i.ackUrl, "I've got this")}</div>
<p style="font-size:13px;color:#6b625b;text-align:center">${link(i.transcriptUrl, "Read the full transcript")}</p>`,
  );

  const text = `"${safe(i.c.caller_quote)}"

${fieldText(i.c, i.callerPhone)}

Flags:
${i.c.flags.map((f) => `- ${safe(f)}`).join("\n") || "- none"}

Booking: ${i.bookingStatus === "booked" && when ? `${when} IST with ${i.designerName}` : i.bookingStatus === "booking_failed" ? "FAILED, call the client within 2 hours" : "not booked"}

I've got this: ${i.ackUrl}
Transcript: ${i.transcriptUrl}`;

  return { subject, html, text };
}

export function existingClientEmail(i: { c: StoredClassification; callerPhone: string | null; transcriptUrl: string; endedAt: string | null }): Rendered {
  const name = displayName(i.c);
  const subject = `[URGENT] Existing client complaint: ${name}`;
  const rows: [string, string][] = [
    ["Name", clean(i.c.fields.name)],
    ["Phone", clean(i.c.fields.phone || i.callerPhone)],
    ["Project location", clean(i.c.fields.location)],
    ["Call ended", i.endedAt ? escapeHtml(formatIst(i.endedAt)) : ""],
  ];
  const html = layout(
    "Urgent",
    `<p style="font-size:16px;margin:0 0 8px"><strong>An existing client called and was promised a callback from a senior person within 15 minutes.</strong></p>
<blockquote style="margin:8px 0;padding:10px 14px;border-left:4px solid #a3281f;background:#fdf3f2;font-style:italic">“${clean(i.c.caller_quote)}”</blockquote>
${fieldTable(rows)}
${flagBox(i.c.flags)}
<p>${link(i.transcriptUrl, "Read the full transcript")}</p>`,
  );
  const text = `An existing client called and was promised a senior callback within 15 minutes.

"${safe(i.c.caller_quote)}"

${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}
Flags: ${i.c.flags.map(safe).join("; ") || "none"}
Transcript: ${i.transcriptUrl}`;
  return { subject, html, text };
}

export function needsReviewEmail(i: { c: StoredClassification; callerPhone: string | null; transcriptUrl: string; reason: string; bookingStart: string | null; designerName: string | null }): Rendered {
  const name = displayName(i.c);
  const subject = `[Needs review] ${name}${i.c.fields.location ? `, ${safe(i.c.fields.location)}` : ""}`;
  const booked = i.bookingStart
    ? `<p>The agent booked a consultation for <strong>${escapeHtml(formatIst(i.bookingStart))}</strong> with ${escapeHtml(i.designerName ?? "a designer")}. The designer has been sent the brief marked "pending review".</p>`
    : "";
  const html = layout(
    "Needs review",
    `<p style="margin:0 0 8px"><strong>Why:</strong> ${clean(i.reason)}</p>
${booked}
<blockquote style="margin:8px 0;padding:10px 14px;border-left:4px solid ${BRAND};background:#faf7f3;font-style:italic">“${clean(i.c.caller_quote) || "No quote captured"}”</blockquote>
${fieldTable(fieldRows(i.c, i.callerPhone))}
${flagBox(i.c.flags)}
<p>${link(i.transcriptUrl, "Read the full transcript")}</p>`,
  );
  const text = `Why: ${safe(i.reason)}
${i.bookingStart ? `Booked: ${formatIst(i.bookingStart)} with ${i.designerName ?? "a designer"}\n` : ""}
"${safe(i.c.caller_quote)}"

${fieldText(i.c, i.callerPhone)}
Flags: ${i.c.flags.map(safe).join("; ") || "none"}
Transcript: ${i.transcriptUrl}`;
  return { subject, html, text };
}

export function complianceEmail(i: { callId: string; transcriptUrl: string; endedAt: string | null }): Rendered {
  const subject = "[Compliance] The agent mentioned a price on a call";
  const html = layout(
    "Compliance incident",
    `<p style="font-size:16px;margin:0 0 8px"><strong>The classifier detected the voice agent saying a price, range or rate.</strong> The agent must never quote prices.</p>
<p>Call ended ${i.endedAt ? escapeHtml(formatIst(i.endedAt)) : "(time unknown)"}. Check the transcript and the Vaani system prompt.</p>
<p>${link(i.transcriptUrl, "Open the transcript")}</p>`,
  );
  const text = `The classifier detected the voice agent saying a price, range or rate.
Call ended ${i.endedAt ? formatIst(i.endedAt) : "(time unknown)"}.
Transcript: ${i.transcriptUrl}`;
  return { subject, html, text };
}

export function unacknowledgedEmail(i: { leadName: string; designerName: string; emailSentAt: string; transcriptUrl: string }): Rendered {
  const subject = `Unacknowledged lead: ${safe(i.leadName)}, assigned to ${i.designerName}`;
  const html = layout(
    "Unacknowledged lead",
    `<p>${escapeHtml(i.designerName)} has not acknowledged the lead for <strong>${clean(i.leadName)}</strong>, sent ${escapeHtml(formatIst(i.emailSentAt))}.</p>
<p>${link(i.transcriptUrl, "Open the call")}</p>`,
  );
  const text = `${i.designerName} has not acknowledged the lead for ${safe(i.leadName)}, sent ${formatIst(i.emailSentAt)}.
${i.transcriptUrl}`;
  return { subject, html, text };
}

export interface DigestInput {
  dateLabel: string;
  total: number;
  afterHours: number;
  avgDurationSeconds: number | null;
  outcomes: Record<string, number>;
  declineReasons: Record<string, number>;
  booked: number;
  bookingFailed: number;
  unacknowledged: { name: string; designer: string; sentAt: string; url: string }[];
  callbacks: { phone: string; at: string; url: string }[];
  incidents: number;
  dashboardUrl: string;
}

export function digestEmail(d: DigestInput): Rendered {
  const subject = `Aangan calls · ${d.dateLabel}: ${d.total} calls, ${d.outcomes.qualified ?? 0} qualified, ${d.booked} booked`;
  const outcomeRows: [string, string][] = Object.entries(d.outcomes).map(([k, v]) => [k.replace(/_/g, " "), String(v)]);
  const declineRows: [string, string][] = Object.entries(d.declineReasons).map(([k, v]) => [k.replace(/_/g, " "), String(v)]);
  const list = (items: string[]) => (items.length ? `<ul style="padding-left:18px">${items.join("")}</ul>` : "<p style='color:#6b625b'>None.</p>");

  const html = layout(
    `Daily digest · ${d.dateLabel}`,
    `${fieldTable([
      ["Calls answered", String(d.total)],
      ["After hours", String(d.afterHours)],
      ["Average call length", escapeHtml(formatDuration(d.avgDurationSeconds))],
      ["Consultations booked", String(d.booked)],
      ["Booking failures", String(d.bookingFailed)],
      ["Compliance incidents", d.incidents ? `<strong style="color:#a3281f">${d.incidents}</strong>` : "0"],
    ])}
<h3 style="font-size:15px;margin:16px 0 4px">Outcomes</h3>
${outcomeRows.length ? fieldTable(outcomeRows) : "<p style='color:#6b625b'>No calls.</p>"}
${declineRows.length ? `<h3 style="font-size:15px;margin:16px 0 4px">Decline reasons</h3>${fieldTable(declineRows)}` : ""}
<h3 style="font-size:15px;margin:16px 0 4px">Unacknowledged leads</h3>
${list(d.unacknowledged.map((u) => `<li>${link(u.url, safe(u.name))}, ${escapeHtml(u.designer)}, sent ${escapeHtml(formatIst(u.sentAt))}</li>`))}
<h3 style="font-size:15px;margin:16px 0 4px">Dropped calls to call back</h3>
${list(d.callbacks.map((c) => `<li>${link(c.url, c.phone)} at ${escapeHtml(formatIst(c.at))}</li>`))}
<p style="margin-top:20px">${link(d.dashboardUrl, "Open the dashboard")}</p>`,
  );

  const text = `Aangan calls, ${d.dateLabel}
Calls: ${d.total} (after hours ${d.afterHours}), avg ${formatDuration(d.avgDurationSeconds)}
Booked: ${d.booked}, booking failures: ${d.bookingFailed}, compliance incidents: ${d.incidents}
Outcomes: ${Object.entries(d.outcomes).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}
Decline reasons: ${Object.entries(d.declineReasons).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}
Unacknowledged: ${d.unacknowledged.map((u) => `${safe(u.name)} (${u.designer})`).join(", ") || "none"}
Call back: ${d.callbacks.map((c) => c.phone).join(", ") || "none"}
Dashboard: ${d.dashboardUrl}`;
  return { subject, html, text };
}
