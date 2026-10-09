import { timingSafeEqual } from "node:crypto";

/** Vercel Cron (and the GitHub Actions cron workflow) send `Authorization: Bearer $CRON_SECRET`. */
export function isAuthorizedCron(req: Request): boolean {
  // Read the request first: under Cache Components this marks the GET handler as request-time.
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  return got.length === expected.length && timingSafeEqual(got, expected);
}
