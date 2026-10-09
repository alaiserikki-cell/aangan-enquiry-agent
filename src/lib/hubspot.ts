// HubSpot CRM (free tier) via the v3 REST API. Contacts + deals only; never sets a deal amount.

import { env, envOptional } from "./env";
import { assertSafeToSend } from "./price-guard";

const BASE = "https://api.hubapi.com";
const DEAL_TO_CONTACT_ASSOCIATION = 3; // HubSpot-defined association type: deal → contact

async function hs<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env("HUBSPOT_ACCESS_TOKEN")}`, "Content-Type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`HubSpot ${init.method ?? "GET"} ${path} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

function splitName(full: string | null): { firstname?: string; lastname?: string } {
  if (!full) return {};
  const parts = full.trim().split(/\s+/);
  return parts.length === 1 ? { firstname: parts[0] } : { firstname: parts.slice(0, -1).join(" "), lastname: parts.at(-1) };
}

/** Find by phone, else create. Updates name/city on an existing contact. Returns contact ID. */
export async function upsertContact(c: { name: string | null; phone: string | null; location: string | null }): Promise<string> {
  const properties: Record<string, string> = { ...splitName(c.name) } as Record<string, string>;
  if (c.phone) properties.phone = c.phone;
  if (c.location) properties.city = c.location;

  if (c.phone) {
    const found = await hs<{ results: { id: string }[] }>("/crm/v3/objects/contacts/search", {
      method: "POST",
      body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: "phone", operator: "EQ", value: c.phone }] }], limit: 1 }),
    });
    if (found.results[0]) {
      await hs(`/crm/v3/objects/contacts/${found.results[0].id}`, { method: "PATCH", body: JSON.stringify({ properties }) });
      return found.results[0].id;
    }
  }
  const created = await hs<{ id: string }>("/crm/v3/objects/contacts", { method: "POST", body: JSON.stringify({ properties }) });
  return created.id;
}

export function stageConsultationBooked(): string {
  return env("HUBSPOT_STAGE_CONSULTATION_BOOKED");
}

/** Deal in the "Consultation booked" stage. No amount, ever. */
export async function createDeal(d: { name: string; description: string; contactId: string; consultationAt: string | null }): Promise<{ id: string; stage: string }> {
  assertSafeToSend(`${d.name}\n${d.description}`, "HubSpot deal");
  const stage = stageConsultationBooked();
  const properties: Record<string, string> = {
    dealname: d.name,
    pipeline: envOptional("HUBSPOT_PIPELINE_ID", "default"),
    dealstage: stage,
    description: d.description,
  };
  if (d.consultationAt) properties.closedate = d.consultationAt; // HubSpot requires *a* date for forecasting; we use the consultation date
  const created = await hs<{ id: string }>("/crm/v3/objects/deals", {
    method: "POST",
    body: JSON.stringify({
      properties,
      associations: [{ to: { id: d.contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: DEAL_TO_CONTACT_ASSOCIATION }] }],
    }),
  });
  return { id: created.id, stage };
}

export interface DealState {
  id: string;
  stage: string;
  isClosed: boolean;
  isClosedWon: boolean;
  amount: number | null; // only meaningful when a human marked it won
}

/** Batch-read current stage for up to 100 deals per request. */
export async function readDeals(ids: string[]): Promise<DealState[]> {
  const out: DealState[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const res = await hs<{ results: { id: string; properties: Record<string, string | null> }[] }>("/crm/v3/objects/deals/batch/read", {
      method: "POST",
      body: JSON.stringify({ properties: ["dealstage", "amount", "hs_is_closed", "hs_is_closed_won"], inputs: batch.map((id) => ({ id })) }),
    });
    for (const r of res.results) {
      const won = r.properties.hs_is_closed_won === "true";
      out.push({
        id: r.id,
        stage: r.properties.dealstage ?? "",
        isClosed: r.properties.hs_is_closed === "true",
        isClosedWon: won,
        amount: won && r.properties.amount ? Number(r.properties.amount) : null,
      });
    }
  }
  return out;
}
