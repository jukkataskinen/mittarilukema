import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { migrationDatabaseUrl, stripSslMode } from "../../src/lib/config/deploy-env.ts";

/**
 * Migraatiot Supabaseen (eRapun malli).
 *
 *   npx tsx scripts/db/migrate-remote.mts            ajaa, jos kanta on asetettu
 *   npx tsx scripts/db/migrate-remote.mts --vercel   Vercelin buildissa: vain tuotantojulkaisussa
 *
 * - Sama `ml_schema_migrations`-kirjanpito kuin paikallisessa PGlitessä.
 *   `supabase/local`-jäljitelmää ei ajeta: Supabasessa auth-skeema ja roolit ovat valmiina.
 * - Jokainen migraatio omassa transaktiossaan; virhe pysäyttää ajon ja buildin.
 * - Advisory lock estää kahden samanaikaisen julkaisun päällekkäiset ajot.
 */

const onVercel = process.argv.includes("--vercel");
if (onVercel && process.env.VERCEL_ENV !== "production") {
  console.log(`Migraatiot ohitettu (VERCEL_ENV=${process.env.VERCEL_ENV ?? "–"}). Ne ajetaan vain tuotantojulkaisussa.`);
  process.exit(0);
}

const url = migrationDatabaseUrl();
if (!url) {
  // Tuotantojulkaisu ilman kantaa ei kaada buildia: sovellus näyttää silloin vain
  // kirjautumissivun. Kun DATABASE_URL on asetettu Verceliin, migraatiot ajetaan.
  console.log("Tietokantayhteyttä ei ole asetettu, migraatiot ohitettu.");
  process.exit(0);
}

const client = new pg.Client({ connectionString: stripSslMode(url), ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query("select pg_advisory_lock(hashtext('mittarilukema_migrations'))");
  await client.query(`create table if not exists ml_schema_migrations (name text primary key, applied_at timestamptz not null default now());
    grant select on ml_schema_migrations to service_role;`);
  const applied = new Set((await client.query<{ name: string }>("select name from ml_schema_migrations")).rows.map((r) => r.name));
  const dir = path.join(process.cwd(), "supabase/migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(dir, file), "utf8");
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into ml_schema_migrations (name) values ($1)", [file]);
      await client.query("commit");
      ran.push(file);
    } catch (err) {
      await client.query("rollback");
      throw new Error(`Migraatio ${file} epäonnistui: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(ran.length ? `Migraatiot ajettu: ${ran.join(", ")}` : "Kanta on ajan tasalla.");
} finally {
  await client.query("select pg_advisory_unlock(hashtext('mittarilukema_migrations'))").catch(() => undefined);
  await client.end();
}
