import { createHash } from "node:crypto";
import { sql, sqlOne } from "@/lib/db";
import { envOptional } from "@/lib/env";
import { log } from "@/lib/log";
import { VaaniNotConfiguredError, startWebCall } from "@/lib/vaani/adapter";

export const maxDuration = 30;

const GREETING =
  "Hello, thank you for calling Aangan Studio. I'm the studio's AI assistant, and this call is recorded so our designers can follow up on your project. How can I help you today?";

const num = (name: string, fallback: number) => {
  const v = Number(envOptional(name, String(fallback)));
  return Number.isFinite(v) && v >= 0 ? v : fallback;
};

/** Public status for the button: is calling available right now, and how long can a call last. */
export async function GET() {
  const limits = await usage();
  return Response.json({ ...limits.public });
}

/**
 * Start a public web call. Every guard here protects the free Vaani credit:
 * on/off switch, daily cap, lifetime cap, and a hard per-call time limit.
 */
export async function POST(req: Request) {
  const limits = await usage();
  if (!limits.public.enabled) return Response.json({ ok: false, reason: limits.public.reason }, { status: 429 });

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const visitor = createHash("sha256").update(`${ip}|${process.env.CRON_SECRET ?? "aangan"}`).digest("hex");
  // Only a double-click guard; the daily/total caps and the per-call time limit protect the credit.
  const justStarted = await sqlOne<{ n: number }>`
    select count(*)::int as n from web_calls where visitor_hash = ${visitor} and created_at > now() - interval '20 seconds'`;
  if ((justStarted?.n ?? 0) > 0) {
    return Response.json({ ok: false, reason: "A call is already starting. Give it a few seconds." }, { status: 429 });
  }

  try {
    const session = await startWebCall({ maxMinutes: limits.maxMinutes, greeting: GREETING });
    await sql`insert into web_calls (room_name, visitor_hash, vaani_call_id) values (${session.roomName}, ${visitor}, ${session.callId})`;
    log.info("webcall.started", { room: session.roomName });
    return Response.json({ ok: true, token: session.token, connectionUrl: session.connectionUrl, roomName: session.roomName, maxMinutes: limits.maxMinutes });
  } catch (err) {
    log.error("webcall.start_failed", err);
    const reason = err instanceof VaaniNotConfiguredError ? "Web calling isn't set up yet." : "Couldn't start the call. Please try again in a minute.";
    return Response.json({ ok: false, reason }, { status: 502 });
  }
}

async function usage() {
  const enabled = envOptional("WEBCALL_ENABLED", "true") !== "false";
  const daily = num("WEBCALL_DAILY_LIMIT", 8);
  const total = num("WEBCALL_TOTAL_LIMIT", 20);
  const maxMinutes = Math.max(1, Math.min(10, num("WEBCALL_MAX_MINUTES", 3)));
  const [counts] = await sql<{ today: number; all: number }>`
    select count(*) filter (where created_at > date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')::int as today,
           count(*)::int as all
    from web_calls`;
  let reason: string | null = null;
  if (!enabled) reason = "Web calling is switched off.";
  else if (counts.all >= total) reason = "The free test-call allowance has been used up.";
  else if (counts.today >= daily) reason = "Today's test calls are used up. Please try again tomorrow.";
  return {
    maxMinutes,
    public: { enabled: reason === null, reason, maxMinutes, remainingToday: Math.max(0, daily - counts.today), remainingTotal: Math.max(0, total - counts.all) },
  };
}
