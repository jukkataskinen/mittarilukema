import { createPostgresDatabase } from "../../src/lib/db/postgres.ts";
import { databaseUrl } from "../../src/lib/config/deploy-env.ts";
import { openLocalDb } from "./local-db.mts";

/**
 * Skriptin kohdekanta: oletuksena paikallinen PGlite, `--tuotanto` käyttää
 * `.env.local`:n DATABASE_URL-osoitetta (Supabase). Kohde tulostetaan aina,
 * jotta tuotantoajo ei tapahdu huomaamatta.
 */
export async function openTargetDb(args: string[]) {
  if (args.includes("--tuotanto")) {
    const url = databaseUrl();
    if (!url) throw new Error("DATABASE_URL puuttuu .env.local-tiedostosta.");
    console.log(`Kohde: tuotantokanta (${new URL(url).hostname})`);
    return createPostgresDatabase(url);
  }
  console.log("Kohde: paikallinen kanta");
  return openLocalDb();
}
