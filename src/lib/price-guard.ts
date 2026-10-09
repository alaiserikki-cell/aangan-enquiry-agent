// Safety rule: no price, range or per-sq-ft figure ever appears in any email, deal or
// dashboard text. Every caller-derived string is passed through redactPrices() before it is
// rendered, and every finished email / deal description is checked with findPriceFigures()
// as a last line of defence (a hit blocks the send).

const PATTERNS: RegExp[] = [
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

export function findPriceFigures(text: string): string[] {
  const hits: string[] = [];
  for (const p of PATTERNS) for (const m of text.matchAll(p)) hits.push(m[0]);
  return hits;
}

export function redactPrices(text: string): string {
  return PATTERNS.reduce((acc, p) => acc.replace(p, "[amount withheld]"), text);
}

export class PriceFigureError extends Error {
  constructor(public readonly where: string, public readonly hits: string[]) {
    super(`Price figure found in ${where}; send blocked`);
  }
}

export function assertNoPriceFigures(text: string, where: string): void {
  // Strip our own redaction marker before checking.
  const hits = findPriceFigures(text.replaceAll("[amount withheld]", ""));
  if (hits.length) throw new PriceFigureError(where, hits);
}
