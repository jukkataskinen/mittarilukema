/**
 * Ympäristömuuttujat eri lähteistä (eRapun malli). Vercelin Supabase-integraatio
 * kirjoittaa omat nimensä (`POSTGRES_URL`), käsin asetetut käyttävät omia
 * nimiä, jotka voittavat. Ei `server-only`-merkintää, koska skriptit käyttävät tätä.
 */

type Env = Record<string, string | undefined>;

/** Sovelluksen yhteys: transaktiopooleri riittää, koska kaikki kyselyt ovat transaktioissa. */
export function databaseUrl(env: Env = process.env): string | undefined {
  return env.DATABASE_URL || env.POSTGRES_URL || undefined;
}

/**
 * Migraatiot session-tilassa. Supabasen jaetun poolerin transaktiotila
 * (portti 6543) ei sovi pitkiin DDL-ajoihin ja advisory lockiin, joten sama
 * palvelin otetaan session-tilassa (5432). Suora osoite voittaa, jos se on annettu.
 */
export function migrationDatabaseUrl(env: Env = process.env): string | undefined {
  const direct = env.DATABASE_URL_DIRECT || env.POSTGRES_URL_NON_POOLING;
  if (direct) return direct;
  const url = databaseUrl(env);
  if (!url) return undefined;
  try {
    const u = new URL(url);
    if (u.hostname.endsWith(".pooler.supabase.com") && u.port === "6543") u.port = "5432";
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Kehityksessä PGlite on oletus, vaikka `.env.local`:ssa olisi Supabasen
 * osoite: paikallinen työ ja demodata eivät saa päätyä oikeaan kantaan.
 * Vercelissä oletus on Postgres.
 */
export function dbDriver(env: Env = process.env): "postgres" | "pglite" {
  if (env.DB_DRIVER === "postgres" || env.DB_DRIVER === "pglite") return env.DB_DRIVER;
  return env.VERCEL && databaseUrl(env) ? "postgres" : "pglite";
}

/**
 * Integraation osoitteissa on usein `sslmode=require`, jonka pg tulkitsee
 * täydeksi varmennetarkistukseksi. Poistetaan, SSL asetetaan poolin optioilla.
 */
export function stripSslMode(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete("sslmode");
    return u.toString();
  } catch {
    return url;
  }
}
