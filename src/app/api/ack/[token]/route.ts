import { acknowledge } from "@/lib/ack";
import { escapeHtml } from "@/lib/email/templates";
import { formatIst } from "@/lib/time";

// GET shows a one-button page; POST records the acknowledgement.
// Email security scanners (Outlook Safe Links, Gmail) pre-fetch links with GET, which would
// silently acknowledge every lead. A POST only happens when a person taps the button.

function page(title: string, body: string, status = 200): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title>
<style>body{margin:0;font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f3ef;color:#2b2420;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}
.card{background:#fff;border:1px solid #e7e0d8;border-radius:10px;padding:28px;max-width:420px;width:100%;text-align:center}
h1{font-size:22px;margin:0 0 10px}p{color:#6b625b;line-height:1.5}button{background:#7a4b2a;color:#fff;border:0;border-radius:6px;padding:14px 28px;font-size:16px;font-weight:600;cursor:pointer;width:100%}</style></head>
<body><div class="card">${body}</div></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

export async function GET(_req: Request, ctx: RouteContext<"/api/ack/[token]">) {
  const { token } = await ctx.params;
  return page(
    "Confirm lead",
    `<h1>Take this lead?</h1><p>Tap to confirm you're handling it. Nikhil won't be chased about it.</p>
<form method="post" action="/api/ack/${encodeURIComponent(token)}"><button type="submit">I've got this</button></form>`,
  );
}

export async function POST(_req: Request, ctx: RouteContext<"/api/ack/[token]">) {
  const { token } = await ctx.params;
  const result = await acknowledge(token);
  switch (result.status) {
    case "acknowledged":
      return page("Thanks", `<h1>Got it ✓</h1><p>${result.leadName ? `${escapeHtml(result.leadName)} is yours.` : "The lead is yours."} Nikhil can see you've picked it up.</p>`);
    case "already":
      return page("Already confirmed", `<h1>Already confirmed</h1><p>This lead was acknowledged ${escapeHtml(formatIst(result.acknowledgedAt))}.</p>`);
    case "expired":
      return page("Link expired", `<h1>Link expired</h1><p>This link was valid for 7 days. Please tell Nikhil directly.</p>`, 410);
    case "invalid":
      return page("Invalid link", `<h1>Invalid link</h1><p>This link isn't recognised.</p>`, 404);
  }
}
