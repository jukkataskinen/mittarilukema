import { openTargetDb } from "./lib/target-db.mts";
import { joutsaAreaName } from "../src/lib/import/fennoa.ts";

/**
 * Joutsan kiinteistöjen alueet käyttöpaikan tunnuksesta (Unes).
 *
 *   npm run joutsa:alueet [-- --tuotanto] [--kuiva]
 *
 * Ensimmäinen numero 1–8 → "Alue 1"–"Alue 8", 9 → Rutalahti (Jukka 25.9.2026).
 * Alueen nimen voi muuttaa Asetuksissa; hinnat ja laskutusajot viittaavat
 * alueen tunnisteeseen, eivät nimeen.
 */

const args = process.argv.slice(2);
const dryRun = args.includes("--kuiva");
const ORG = "Joutsan Vesihuolto Oy";

const db = await openTargetDb(args);
const counts = new Map<string, number>();
let unchanged = 0;
let noId = 0;
try {
  await db.asService(async (tx) => {
    const [org] = await tx.query<{ id: string }>("select id from ml_organizations where name = $1", [ORG]);
    if (!org) throw new Error(`Organisaatiota ${ORG} ei löydy.`);
    const props = await tx.query<{ id: string; legacy_id: string | null; area_id: string | null }>(
      "select id, legacy_id, area_id from ml_properties where organization_id = $1",
      [org.id],
    );
    const areaIds = new Map<string, string>();
    for (const p of props) {
      const name = joutsaAreaName(p.legacy_id);
      if (!name) {
        noId++;
        continue;
      }
      if (!areaIds.has(name)) {
        const [a] = await tx.query<{ id: string }>(
          "insert into ml_areas (organization_id, name) values ($1, $2) on conflict (organization_id, name) do update set name = excluded.name returning id",
          [org.id, name],
        );
        areaIds.set(name, a.id);
      }
      const areaId = areaIds.get(name)!;
      counts.set(name, (counts.get(name) ?? 0) + 1);
      if (p.area_id === areaId) {
        unchanged++;
        continue;
      }
      await tx.query("update ml_properties set area_id = $2 where id = $1", [p.id, areaId]);
    }
    await tx.query("insert into ml_audit_log (organization_id, action, entity, details) values ($1, 'areas.from_unes', 'ml_properties', $2)", [
      org.id,
      JSON.stringify(Object.fromEntries(counts)),
    ]);
    if (dryRun) throw new Error("__kuiva__");
  });
} catch (err) {
  if (!(err instanceof Error && err.message === "__kuiva__")) throw err;
  console.log("Kuivaharjoitus: mitään ei tallennettu.");
} finally {
  await db.close();
}
console.log([...counts].sort().map(([k, v]) => `${k}: ${v}`).join(", "));
console.log(`Jo oikealla alueella ${unchanged}, ilman käyttöpaikan tunnusta ${noId}.`);
