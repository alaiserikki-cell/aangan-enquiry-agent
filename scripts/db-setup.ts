/**
 * Apply every db/NNNN_*.sql migration not yet applied, then seed designers if empty.
 *
 *   npm run db:setup
 *
 * Uses DATABASE_URL_UNPOOLED (direct connection, as Neon recommends for schema changes),
 * falling back to DATABASE_URL. Each migration runs in a transaction and is recorded in
 * schema_migrations, so the script is safe to re-run. Uses a WebSocket Pool (not the HTTP
 * driver) because migration files contain multiple statements and $$-quoted functions.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "@neondatabase/serverless";

const DB_DIR = join(__dirname, "..", "db");

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL_UNPOOLED / DATABASE_URL is not set (put it in .env.local)");

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    const { rows: [ver] } = await client.query<{ v: string }>("select version() as v");
    console.log(`Connected: ${ver.v.split(",")[0]}`);

    await client.query("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");

    // Databases created before migration tracking already have 0001 applied.
    const { rows: [legacy] } = await client.query<{ t: string | null }>("select to_regclass('public.calls')::text as t");
    if (legacy.t) await client.query("insert into schema_migrations (name) values ('0001_init.sql') on conflict do nothing");

    const applied = new Set((await client.query<{ name: string }>("select name from schema_migrations")).rows.map((r) => r.name));
    const files = readdirSync(DB_DIR).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`  ✓ ${file} (already applied)`);
        continue;
      }
      await client.query("begin");
      try {
        await client.query(readFileSync(join(DB_DIR, file), "utf8"));
        await client.query("insert into schema_migrations (name) values ($1)", [file]);
        await client.query("commit");
        console.log(`  + ${file} applied`);
      } catch (err) {
        await client.query("rollback");
        throw new Error(`${file}: ${err instanceof Error ? err.message : err}`);
      }
    }

    const { rows: [count] } = await client.query<{ n: number }>("select count(*)::int as n from designers");
    if (count.n > 0) {
      console.log(`Designers table has ${count.n} row(s), skipping seed`);
    } else {
      await client.query(readFileSync(join(DB_DIR, "seed.sql"), "utf8"));
      console.log("Applied db/seed.sql");
    }

    const { rows: tables } = await client.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
    );
    console.log(`Tables: ${tables.map((t) => t.table_name).join(", ")}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("db:setup failed:", String(err instanceof Error ? err.message : err).replace(/npg_[A-Za-z0-9]+/g, "[redacted]"));
  process.exit(1);
});
