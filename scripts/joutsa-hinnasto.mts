import { readFile } from "node:fs/promises";
import { openTargetDb } from "./lib/target-db.mts";

/**
 * Joutsan Vesihuollon hinnasto ja liittymien perusmaksuluokat.
 *
 *   npm run joutsa:hinnasto [-- --tuotanto] [--kuiva]
 *
 * Lähde: https://www.joutsanvesihuolto.fi/perus-ja-kayttomaksut/ (hinnat sis. alv 25,5 %).
 * Kausi 1.9.2024–30.9.2026: verottomat hinnat sellaisina kuin ne ovat Fennoan
 * laskuilla 2026 (DN25 jätevesi 29,23 €, vaikka verollisesta laskettuna 29,24 €).
 * Kausi 1.10.2026 alkaen: verollinen hinta / 1,255 senteille pyöristettynä,
 * vahvistettava Joutsalta (BLOCKERS 8).
 *
 * Liittymän perusmaksuluokka päätellään laskuilla veloitetusta perusmaksusta
 * (data/private/fennoa/invoices.json, käyttöpaikka = kiinteistön legacy_id).
 */

const args = process.argv.slice(2);
const dryRun = args.includes("--kuiva");
const ORG = "Joutsan Vesihuolto Oy";
const CLASSES = ["okt", "dn20", "dn25", "dn32", "dn40", "dn50", "dn65"] as const;
const LABEL: Record<string, string> = { okt: "omakotitalo", dn20: "DN20", dn25: "DN25", dn32: "DN32", dn40: "DN40", dn50: "DN50", dn65: "DN65" };

// [vesi, jätevesi] €/kk alv 0
const FEES_2024: Record<string, [number, number]> = {
  okt: [3.67, 7.02], dn20: [4.33, 8.27], dn25: [18.83, 29.23], dn32: [38.63, 55.23],
  dn40: [69.11, 98.72], dn50: [120.11, 171.76], dn65: [208.94, 298.67],
};
const GROSS_2026: Record<string, [number, number]> = {
  okt: [4.99, 9.51], dn20: [5.86, 11.21], dn25: [25.52, 39.63], dn32: [48.48, 69.31],
  dn40: [86.73, 123.89], dn50: [150.74, 215.56], dn65: [262.22, 374.83],
};
const net = (gross: number) => Math.round((gross / 1.255) * 100) / 100;

type T = { area: string | null; type: string; kind: string | null; cls: string | null; name: string; unit: string; price: number; from: string; to: string | null };
const rows: T[] = [
  { area: null, type: "usage_fee", kind: "water", cls: null, name: "Vesi", unit: "m3", price: 0.95, from: "2024-09-01", to: "2026-09-30" },
  { area: null, type: "usage_fee", kind: "water", cls: null, name: "Vesi", unit: "m3", price: net(1.23), from: "2026-10-01", to: null },
  { area: null, type: "usage_fee", kind: "wastewater", cls: null, name: "Jätevesi", unit: "m3", price: 2.92, from: "2024-09-01", to: null },
];
for (const c of CLASSES) {
  rows.push(
    { area: null, type: "basic_fee", kind: "water", cls: c, name: `Veden perusmaksu, ${LABEL[c]}`, unit: "month", price: FEES_2024[c][0], from: "2024-09-01", to: "2026-09-30" },
    { area: null, type: "basic_fee", kind: "wastewater", cls: c, name: `Jätevesi perusmaksu, ${LABEL[c]}`, unit: "month", price: FEES_2024[c][1], from: "2024-09-01", to: "2026-09-30" },
    { area: null, type: "basic_fee", kind: "water", cls: c, name: `Veden perusmaksu, ${LABEL[c]}`, unit: "month", price: net(GROSS_2026[c][0]), from: "2026-10-01", to: null },
    { area: null, type: "basic_fee", kind: "wastewater", cls: c, name: `Jätevesi perusmaksu, ${LABEL[c]}`, unit: "month", price: net(GROSS_2026[c][1]), from: "2026-10-01", to: null },
  );
}
rows.push(
  { area: "Rutalahti", type: "basic_fee", kind: "wastewater", cls: "okt", name: "Jäteveden perusmaksu Rutalahti, omakotitalo", unit: "month", price: 18.46, from: "2025-07-01", to: null },
  { area: "Rutalahti", type: "basic_fee", kind: "wastewater", cls: "dn20", name: "Jäteveden perusmaksu Rutalahti, DN20", unit: "month", price: 21.78, from: "2025-07-01", to: null },
);

// Laskuilla veloitettu perusmaksu → luokka
const CLASS_BY_PRICE: Record<"water" | "wastewater", Record<string, string>> = { water: {}, wastewater: {} };
for (const c of CLASSES) {
  CLASS_BY_PRICE.water[FEES_2024[c][0].toFixed(2)] = c;
  CLASS_BY_PRICE.wastewater[FEES_2024[c][1].toFixed(2)] = c;
}
CLASS_BY_PRICE.wastewater["18.46"] = "okt";
CLASS_BY_PRICE.wastewater["21.78"] = "dn20";

interface Inv { tyyppi: string; laskupvm: string | null; rivit: { tuote: string; hinta: number | null }[]; lukemat: { unes: string | null }[] }
const invoices: Inv[] = JSON.parse(await readFile("data/private/fennoa/invoices.json", "utf8"));
const classOf = new Map<string, { water?: string; wastewater?: string }>();
for (const i of invoices.filter((x) => x.tyyppi === "Lasku").sort((a, b) => (a.laskupvm ?? "").localeCompare(b.laskupvm ?? ""))) {
  const unes = [...new Set(i.lukemat.map((r) => r.unes).filter((u): u is string => !!u))];
  for (const r of i.rivit) {
    if (!/perusmaksu/i.test(r.tuote) || r.hinta === null) continue;
    const kind = /jäte/i.test(r.tuote) ? "wastewater" : "water";
    const cls = CLASS_BY_PRICE[kind][r.hinta.toFixed(2)];
    if (!cls) continue;
    for (const u of unes) classOf.set(u, { ...classOf.get(u), [kind]: cls });
  }
}

const db = await openTargetDb(args);
const stats = { tariffs: 0, classes: 0, withoutClass: 0 };
try {
  await db.asService(async (tx) => {
    const [org] = await tx.query<{ id: string }>("select id from ml_organizations where name = $1", [ORG]);
    if (!org) throw new Error(`Organisaatiota ${ORG} ei löydy.`);
    const existing = await tx.query("select 1 from ml_tariffs where organization_id = $1 limit 1", [org.id]);
    if (existing.length) throw new Error("Organisaatiolla on jo hinnasto. Poista se ensin, jos haluat tuoda uudelleen.");
    const [area] = await tx.query<{ id: string }>(
      "insert into ml_areas (organization_id, name) values ($1, 'Rutalahti') on conflict (organization_id, name) do update set name = excluded.name returning id",
      [org.id],
    );
    for (const r of rows) {
      await tx.query(
        `insert into ml_tariffs (organization_id, area_id, charge_type, connection_kind, fee_class, name, unit, price_eur, vat_percent, valid_from, valid_to)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 25.5, $9, $10)`,
        [org.id, r.area ? area.id : null, r.type, r.kind, r.cls, r.name, r.unit, r.price, r.from, r.to],
      );
      stats.tariffs++;
    }
    const conns = await tx.query<{ id: string; kind: "water" | "wastewater"; legacy_id: string | null }>(
      `select k.id, k.kind, p.legacy_id from ml_connections k join ml_properties p on p.id = k.property_id
        where k.organization_id = $1 and k.disconnected_on is null`,
      [org.id],
    );
    for (const c of conns) {
      const cls = c.legacy_id ? classOf.get(c.legacy_id)?.[c.kind] : undefined;
      if (!cls) {
        stats.withoutClass++;
        continue;
      }
      await tx.query("update ml_connections set fee_class = $2 where id = $1", [c.id, cls]);
      stats.classes++;
    }
    if (dryRun) throw new Error("__kuiva__");
  });
} catch (err) {
  if (!(err instanceof Error && err.message === "__kuiva__")) throw err;
  console.log("Kuivaharjoitus: mitään ei tallennettu.");
} finally {
  await db.close();
}
console.log(`Hintarivejä ${stats.tariffs}. Liittymille luokka ${stats.classes}, ilman luokkaa ${stats.withoutClass}.`);
