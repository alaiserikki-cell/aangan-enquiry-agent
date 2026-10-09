/**
 * Apply db/0001_init.sql and db/seed.sql to the database in DATABASE_URL.
 *
 *   npm run db:setup
 *
 * Safe to re-run: skips the schema if the tables already exist and only seeds
 * designers when the table is empty. Uses a WebSocket Pool (not the HTTP driver)
 * because the files contain multiple statements and a $$-quoted function.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "@neondatabase/serverless";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (put it in .env.local)");

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    const { rows: [ver] } = await client.query<{ v: string }>("select version() as v");
    console.log(`Connected: ${ver.v.split(",")[0]}`);

    const { rows: [exists] } = await client.query<{ t: string | null }>("select to_regclass('public.calls')::text as t");
    if (exists.t) {
      console.log("Schema already present, skipping db/0001_init.sql");
    } else {
      await client.query("begin");
      await client.query(readFileSync(join(__dirname, "..", "db", "0001_init.sql"), "utf8"));
      await client.query("commit");
      console.log("Applied db/0001_init.sql");
    }

    const { rows: [count] } = await client.query<{ n: number }>("select count(*)::int as n from designers");
    if (count.n > 0) {
      console.log(`Designers table has ${count.n} row(s), skipping seed`);
    } else {
      await client.query(readFileSync(join(__dirname, "..", "db", "seed.sql"), "utf8"));
      console.log("Applied db/seed.sql");
    }

    const { rows: tables } = await client.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
    );
    console.log(`Tables: ${tables.map((t) => t.table_name).join(", ")}`);
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("db:setup failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
