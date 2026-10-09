// Two safety rules for anything we render or send:
// 1. No price, range or per-sq-ft figure ever appears in any email, deal or dashboard text.
// 2. No government or financial ID (Aadhaar, PAN, card number) is shown or sent, even if a
//    caller blurted one out on the call (DPDP data minimisation).
// Every caller-derived string goes through redactForDisplay() before it is rendered, and every
// finished email / deal description is checked with assertSafeToSend() as a last line of
// defence (a hit blocks the send). Phone numbers are deliberately NOT touched here: designers
// need them, and they are rendered from their own field.

const PRICE_PATTERNS: RegExp[] = [
  // ₹5,00,000 · Rs. 5 lakh · INR 500000 · rupees 5L
  /(?:₹|\brs\.?|\binr\b|\brupees?\b)\s*[\d,.]+(?:\s*(?:lakhs?|lacs?|crores?|cr|k|l)\b)?/gi,
  // 5 lakh · 1.5 lakhs · 2-3 lacs · 1 crore · 15k (money-ish suffixes only)
  /\b\d[\d,.]*(?:\s*(?:-|to)\s*\d[\d,.]*)?\s*(?:lakhs?|lacs?|crores?|cr)\b/gi,
  // 1500 per sq ft · 2,000/sqft · 1800 a square foot
  /\b\d[\d,.]*\s*(?:\/|per|a)\s*(?:sq\.?\s*f(?:t|eet|oot)|square\s*f(?:eet|oot)|sqft)\b/gi,
  // "1 to 1.5 L"
  /\b\d[\d,.]*(?:\s*(?:-|to)\s*\d[\d,.]*)?\s*L\b/g,
  // number + rupees after
  /\b\d[\d,.]*\s*(?:rupees|rs\.?|inr)\b/gi,
];

const ID_PATTERNS: RegExp[] = [
  // Aadhaar: 12 digits, first digit 2-9, optionally grouped 4-4-4. Not preceded by "+" or a digit,
  // so an E.164 phone number like +919822012345 is never mistaken for one.
  /(?<![+\d])[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}(?!\d)/g,
  // PAN: ABCDE1234F
  /\b[A-Z]{5}\d{4}[A-Z]\b/g,
  // Card numbers: 13–19 digits, optionally separated by spaces or hyphens.
  /(?<![+\d])(?:\d[ -]?){12,18}\d(?!\d)/g,
];

const PRICE_MARK = "[amount withheld]";
const ID_MARK = "[ID withheld]";

export function findPriceFigures(text: string): string[] {
  const hits: string[] = [];
  for (const p of PRICE_PATTERNS) for (const m of text.matchAll(p)) hits.push(m[0]);
  return hits;
}

export function findSensitiveIds(text: string): string[] {
  const hits: string[] = [];
  for (const p of ID_PATTERNS) for (const m of text.matchAll(p)) hits.push(m[0]);
  return hits;
}

/** Strip money amounts and ID/card numbers from caller-derived text before it is shown. */
export function redactForDisplay(text: string): string {
  const noIds = ID_PATTERNS.reduce((acc, p) => acc.replace(p, ID_MARK), text);
  return PRICE_PATTERNS.reduce((acc, p) => acc.replace(p, PRICE_MARK), noIds);
}

export class BlockedContentError extends Error {
  constructor(public readonly where: string, public readonly hits: string[]) {
    super(`Price figure or sensitive ID found in ${where}; send blocked`);
  }
}

/** Last line of defence before an email or CRM write leaves the system. */
export function assertSafeToSend(text: string, where: string): void {
  const clean = text.replaceAll(PRICE_MARK, "").replaceAll(ID_MARK, "");
  const hits = [...findPriceFigures(clean), ...findSensitiveIds(clean)];
  if (hits.length) throw new BlockedContentError(where, hits);
}
