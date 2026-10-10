import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { env } from "./env";

// Neon serverless Postgres over HTTP. Each query is one fetch, so it works in
// Vercel functions without a connection pool.

const TIMESTAMP = 1114;
const TIMESTAMPTZ = 1184;
const NUMERIC = 1700;
const INT8 = 20;

let client: NeonQueryFunction<false, true> | null = null;

function getClient(): NeonQueryFunction<false, true> {
  // fullResults gives us each column's type OID, so rows can be normalised below.
  // (The HTTP driver does not apply a custom `types` parser config.)
  client ??= neon(env("DATABASE_URL"), { fullResults: true });
  return client;
}

/** Timestamps → ISO strings, numeric/bigint → numbers, to match the row types in types.ts. */
function normalise<T>(result: { rows: Record<string, unknown>[]; fields: { name: string; dataTypeID: number }[] }): T[] {
  const convert = result.fields.filter((f) => [TIMESTAMP, TIMESTAMPTZ, NUMERIC, INT8].includes(f.dataTypeID));
  if (!convert.length) return result.rows as T[];
  for (const row of result.rows) {
    for (const f of convert) {
      const v = row[f.name];
      if (v == null) continue;
      if (f.dataTypeID === NUMERIC || f.dataTypeID === INT8) row[f.name] = Number(v);
      else row[f.name] = v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();
    }
  }
  return result.rows as T[];
}

/**
 * Parameterised query: sql<Row>`select * from calls where id = ${id}`.
 * Values are always sent as bind parameters, never spliced into the SQL text.
 * Pass objects for jsonb columns as JSON strings with a ::jsonb cast.
 */
export async function sql<T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]> {
  const result = await getClient()(strings, ...values);
  return normalise<T>(result as unknown as { rows: Record<string, unknown>[]; fields: { name: string; dataTypeID: number }[] });
}

/** First row or null. */
export async function sqlOne<T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T | null> {
  const rows = await sql<T>(strings, ...values);
  return rows[0] ?? null;
}

export const json = (v: unknown): string => JSON.stringify(v);
