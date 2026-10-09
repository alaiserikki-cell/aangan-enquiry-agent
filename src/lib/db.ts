import { neon, types, type NeonQueryFunction } from "@neondatabase/serverless";
import { env } from "./env";

// Neon serverless Postgres over HTTP. Each query is one fetch, so it works in
// Vercel functions without a connection pool.

const TIMESTAMP = 1114;
const TIMESTAMPTZ = 1184;
const NUMERIC = 1700;
const INT8 = 20;

let client: NeonQueryFunction<false, false> | null = null;

function getClient(): NeonQueryFunction<false, false> {
  client ??= neon(env("DATABASE_URL"), {
    types: {
      // Timestamps as ISO strings and numerics as numbers, matching the row types in types.ts.
      getTypeParser(id, format) {
        const base = types.getTypeParser(id, format);
        if (id === TIMESTAMP || id === TIMESTAMPTZ) {
          return (v: string) => {
            const d = base(v);
            return d instanceof Date ? d.toISOString() : d;
          };
        }
        if (id === NUMERIC || id === INT8) return (v: string) => Number(v);
        return base;
      },
    },
  });
  return client;
}

/**
 * Parameterised query: sql<Row>`select * from calls where id = ${id}`.
 * Values are always sent as bind parameters, never spliced into the SQL text.
 * Pass objects for jsonb columns as JSON strings with a ::jsonb cast.
 */
export async function sql<T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]> {
  return (await getClient()(strings, ...values)) as T[];
}

/** First row or null. */
export async function sqlOne<T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T | null> {
  const rows = await sql<T>(strings, ...values);
  return rows[0] ?? null;
}

export const json = (v: unknown): string => JSON.stringify(v);
