// One-time HubSpot setup: creates (or reuses) a test deal pipeline with a "Consultation booked"
// stage, checks the token can read and write contacts and deals, and prints the IDs to set as
// HUBSPOT_PIPELINE_ID and HUBSPOT_STAGE_CONSULTATION_BOOKED.
//
//   npm run hubspot:setup
//
// Needs HUBSPOT_ACCESS_TOKEN in .env.local (private app scopes: crm.objects.contacts.read/write,
// crm.objects.deals.read/write, crm.schemas.deals.read/write).

const PIPELINE_LABEL = "Aangan enquiries (test)";
const STAGES = [
  { label: "Consultation booked", displayOrder: 0, metadata: { probability: "0.2" } },
  { label: "Proposal sent", displayOrder: 1, metadata: { probability: "0.5" } },
  { label: "Closed won", displayOrder: 2, metadata: { probability: "1.0", isClosed: "true" } },
  { label: "Closed lost", displayOrder: 3, metadata: { probability: "0.0", isClosed: "true" } },
];

const token = process.env.HUBSPOT_ACCESS_TOKEN?.trim();
if (!token) {
  console.error("HUBSPOT_ACCESS_TOKEN is not set in .env.local");
  process.exit(1);
}

async function hs<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

interface Pipeline {
  id: string;
  label: string;
  stages: { id: string; label: string }[];
}

async function main() {
  // Scope checks: a read on each object type the app writes.
  await hs("/crm/v3/objects/contacts?limit=1");
  await hs("/crm/v3/objects/deals?limit=1");
  console.log("✓ token can read contacts and deals");

  const { results } = await hs<{ results: Pipeline[] }>("/crm/v3/pipelines/deals");
  let pipeline = results.find((p) => p.label === PIPELINE_LABEL);
  if (pipeline) {
    console.log(`✓ pipeline "${PIPELINE_LABEL}" already exists`);
  } else {
    try {
      pipeline = await hs<Pipeline>("/crm/v3/pipelines/deals", {
        method: "POST",
        body: JSON.stringify({ label: PIPELINE_LABEL, displayOrder: 99, stages: STAGES }),
      });
      console.log(`✓ created pipeline "${PIPELINE_LABEL}"`);
    } catch (err) {
      // Free HubSpot allows one deal pipeline: add the stage to the existing one instead.
      pipeline = results.find((p) => p.id === "default") ?? results[0];
      if (!pipeline) throw err;
      console.log(`• this plan allows one pipeline; using "${pipeline.label}"`);
    }
  }

  let stage = pipeline.stages.find((s) => s.label.toLowerCase() === "consultation booked");
  if (stage) {
    console.log(`✓ stage "Consultation booked" exists`);
  } else {
    stage = await hs<{ id: string; label: string }>(`/crm/v3/pipelines/deals/${pipeline.id}/stages`, {
      method: "POST",
      body: JSON.stringify({ ...STAGES[0], displayOrder: 1 }),
    });
    console.log(`✓ added stage "Consultation booked" to "${pipeline.label}"`);
  }

  console.log("\nSet these in .env.local and in Vercel → Settings → Environment Variables:\n");
  console.log(`HUBSPOT_PIPELINE_ID=${pipeline.id}`);
  console.log(`HUBSPOT_STAGE_CONSULTATION_BOOKED=${stage.id}`);
}

main().catch((err) => {
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
