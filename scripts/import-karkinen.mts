import { readFile } from "node:fs/promises";
import { openTargetDb } from "./lib/target-db.mts";
import { normalizePhone } from "../src/lib/validation/phone.ts";

/**
 * Kärkisten vesiosuuskunnan rekisteri ja hinnasto ennakkolistasta.
 *
 *   python scripts/karkinen/parse.py <kansio>
 *   npm run karkinen:tuo -- [--org "Kärkisten vesiosuuskunta"] [--luo] [--korvaa] [--kuiva] [--tuotanto]
 *
 * Lähde: data/private/karkinen/karkinen.json. Jokaisesta ennakkolistan
 * huoneistosta tulee kiinteistö (property_code = huoneiston numero), asiakas
 * (asiakasnumero = huoneiston numero) ja
 * laskutettava sopimus. Jos sama numero on listalla kahdesti eri maksajalla,
 * jälkimmäisen asiakasnumero on muotoa "39-2". Maksulajit:
 *   30 Perusmaksu            hinnasto, jätevesiliittymän perusmaksuluokka okt
 *   31 Perusmaksu 2          kiinteistön maksu, etäluettavien mittarien hankinta, listan kuukaudesta alkaen
 *                            (ei tammi-, maalis- eikä toukokuun 2026 laskuilla)
 *   34/35 Vesi/Jätevesi arvio liittymät ja kuukausiarvio (estimated_annual_m3 = 12 × kk)
 *   40 Liittymän lisämaksu   kiinteistön maksu, alv 0
 *   50 Jäsenmaksu            kertamaksu listan kuukaudelle, alv 0
 *   21/22 Lyhennys ja korko  lainaosuus Lainaosuudet-taulukon saldosta
 * Kaikki hinnat ovat verollisia. Toinen perusmaksu samalla huoneistolla
 * tuodaan kiinteistön maksuna. Hinnasto: listan hinnat 27.2.2026 alkaen
 * (hallituksen päätös 15.1.2026), sitä ennen vuoden 2025 laskujen hinnat.
 *
 * Liittymis- ja sopimuspäivät eivät ole aineistossa: käytetään 1.1.2026.
 * Tuloste näyttää vain määrät.
 */

const args = process.argv.slice(2);
const orgName = args.includes("--org") ? args[args.indexOf("--org") + 1] : "Kärkisten vesiosuuskunta";
const dryRun = args.includes("--kuiva");
const FILE = "data/private/karkinen/karkinen.json";
const START = "2026-01-01";
// Hinnat ennen korotusta 27.2.2026 (laskut 10/2025–1/2026 ja vuoden 2025 tasaus), verollisia.
const PRICES_2025 = { basic: 44.67, water: 2.23, wastewater: 2.85 };
const PRICE_CHANGE = "2026-02-27";

type Row = { koodi: string; laji: string; maara: number | null; yks: string | null; hinta: number | null; alv: number; summa: number | null };
type Point = { kulutuspiste: string; osoite: string | null; paikkakunta: string | null; postinumero: string | null; huom: string | null; nimi: string | null; email: string | null; puhelin: string | null; puhelin2: string | null };
type Loan = { saldo: number; saldopaiva: string; lyhennys: number; viimeinen_kk: string | null; huom: string | null };
type Unit = { nro: string; tunnus: string; osoite: string; maksaja: string; rivit: Row[]; kayttopaikka: Point | null; laina: Loan | null };

const data = JSON.parse(await readFile(FILE, "utf8")) as { jakso: string; huoneistot: Unit[] };
const periodMonth = `${data.jakso.slice(0, 4)}-${data.jakso.slice(4, 6)}-01`;
// Kuolinpesä laskutetaan kuluttajana (kuluttajan e-lasku, account_type 2), joten se ei ole yritys.
const COMPANY = /\b(oy|oyj|ab|ky|ay|tmi|ry|kunta|seurakunta|osakaskunta|yhtymä|säätiö|osuuskunta)\b/i;

const price = (units: Unit[], code: string) => {
  const prices = new Set(units.flatMap((u) => u.rivit.filter((r) => r.koodi === code).map((r) => r.hinta)));
  if (prices.size !== 1) throw new Error(`Maksulajilla ${code} on ${prices.size} eri hintaa.`);
  return [...prices][0] as number;
};

const db = await openTargetDb(args);
const stats = { units: 0, customers: 0, points: 0, water: 0, wastewater: 0, charges: 0, loans: 0, noEstimate: 0, noConnection: 0 };

try {
  await db.asService(async (tx) => {
    let [org] = await tx.query<{ id: string }>("select id from ml_organizations where name = $1", [orgName]);
    if (!org && args.includes("--luo")) {
      [org] = await tx.query<{ id: string }>(
        "insert into ml_organizations (name, billing_method, billing_months) values ($1, 'estimate', '{1,2,3,4,5,6,7,8,9,10,11,12}') returning id",
        [orgName],
      );
      await tx.query(
        "insert into ml_org_members (organization_id, user_id, role) select distinct $1::uuid, user_id, 'owner' from ml_org_members where role = 'owner'",
        [org.id],
      );
      console.log(`Organisaatio "${orgName}" luotu.`);
    }
    if (!org) throw new Error(`Organisaatiota "${orgName}" ei löydy. Lisää --luo, jos haluat luoda sen.`);

    const [existing] = await tx.query<{ props: number; approved: number }>(
      `select (select count(*) from ml_properties where organization_id = $1)::int as props,
              (select count(*) from ml_billing_runs where organization_id = $1 and status = 'approved')::int as approved`,
      [org.id],
    );
    if (existing.props > 0) {
      if (!args.includes("--korvaa")) throw new Error(`Organisaatiolla on jo ${existing.props} kiinteistöä. Lisää --korvaa, jos haluat tuoda rekisterin uudelleen.`);
      if (existing.approved > 0) throw new Error("Organisaatiolla on hyväksyttyjä laskutusajoja, joten rekisteriä ei korvata.");
      // Luonnosajot, sopimukset, kiinteistöt (liittymät, mittarit, maksut ja lainat seuraavat) ja asiakkaat pois.
      for (const t of ["ml_billing_runs", "ml_contracts", "ml_reading_rounds", "ml_properties", "ml_customers", "ml_tariffs"]) {
        await tx.query(`delete from ${t} where organization_id = $1`, [org.id]);
      }
      console.log("Aiempi rekisteri ja hinnasto poistettu.");
    }
    await tx.query("update ml_organizations set estimate_basis = 'manual' where id = $1", [org.id]);

    // Hinnasto: verolliset hinnat listalta.
    const units = data.huoneistot;
    const tariffs = [
      { type: "basic_fee", kind: null, cls: "okt", name: "Perusmaksu", unit: "month", old: PRICES_2025.basic, price: price(units, "30") },
      { type: "usage_fee", kind: "water", cls: null, name: "Vesi", unit: "m3", old: PRICES_2025.water, price: price(units, "34") },
      { type: "usage_fee", kind: "wastewater", cls: null, name: "Jätevesi", unit: "m3", old: PRICES_2025.wastewater, price: price(units, "35") },
    ];
    for (const t of tariffs) {
      for (const [p, from, to] of [[t.old, "2025-01-01", "2026-02-26"], [t.price, PRICE_CHANGE, null]] as const) {
        await tx.query(
          `insert into ml_tariffs (organization_id, charge_type, connection_kind, fee_class, name, unit, price_eur, vat_percent, price_includes_vat, valid_from, valid_to)
           values ($1, $2, $3, $4, $5, $6, $7, 25.5, true, $8, $9)`,
          [org.id, t.type, t.kind, t.cls, t.name, t.unit, p, from, to],
        );
      }
    }

    for (const u of units) {
      stats.units++;
      const codes = (c: string) => u.rivit.filter((r) => r.koodi === c);
      const p = u.kayttopaikka;
      if (p) stats.points++;

      const phone = p?.puhelin ? normalizePhone(p.puhelin) : null;
      const [customer] = await tx.query<{ id: string }>(
        `insert into ml_customers (organization_id, customer_number, kind, name, email, phone, notes)
         values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [
          org.id, u.tunnus, COMPANY.test(u.maksaja) ? "company" : "person", u.maksaja || `Huoneisto ${u.nro}`,
          p?.email?.includes("@") ? p.email.toLowerCase() : null, phone,
          [p?.puhelin && !phone ? `Puhelin tuonnissa: ${p.puhelin}` : null, p?.puhelin2 ? `Puhelin 2: ${p.puhelin2}` : null].filter(Boolean).join("\n") || null,
        ],
      );
      stats.customers++;

      // Kuukausiarvio jätevedestä (kattaa myös pelkän jäteveden), muuten vedestä.
      const m3 = (rows: Row[]) => rows.reduce((s, r) => s + (r.maara ?? 0), 0);
      const monthly = codes("35").length ? m3(codes("35")) : m3(codes("34"));
      const hasWaste = codes("35").length > 0 || codes("30").length > 0;
      const hasWater = codes("34").length > 0;
      const [property] = await tx.query<{ id: string }>(
        `insert into ml_properties (organization_id, property_code, street_address, postal_code, city, estimated_annual_m3, notes, legacy_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [
          org.id, u.nro, u.osoite || p?.osoite || `Huoneisto ${u.nro}`, p?.postinumero ?? null, p?.paikkakunta ? capitalize(p.paikkakunta) : null,
          Math.round(monthly * 12 * 100) / 100, p?.huom ?? null, p?.kulutuspiste ?? null,
        ],
      );
      if (!monthly && (hasWater || hasWaste)) stats.noEstimate++;
      if (!hasWater && !hasWaste) stats.noConnection++;

      if (hasWaste) {
        await tx.query("insert into ml_connections (organization_id, property_id, kind, connected_on, fee_class) values ($1, $2, 'wastewater', $3, 'okt')", [org.id, property.id, START]);
        stats.wastewater++;
      }
      if (hasWater) {
        await tx.query("insert into ml_connections (organization_id, property_id, kind, connected_on, fee_class) values ($1, $2, 'water', $3, $4)", [
          org.id, property.id, START, hasWaste ? "none" : "okt",
        ]);
        stats.water++;
      }
      await tx.query("insert into ml_contracts (organization_id, property_id, customer_id, role, starts_on) values ($1, $2, $3, 'owner', $4)", [
        org.id, property.id, customer.id, START,
      ]);

      // Kiinteistön omat maksut.
      const charges: { name: string; unit: "month" | "once"; price: number; vat: number; from: string; code: string }[] = [];
      for (const [i, r] of codes("30").entries()) if (i > 0) charges.push({ name: "Perusmaksu", unit: "month", price: r.hinta ?? 0, vat: 25.5, from: START, code: "30" });
      for (const r of codes("31")) charges.push({ name: "Perusmaksu 2 (etäluettavat mittarit)", unit: "month", price: r.hinta ?? 0, vat: 25.5, from: periodMonth, code: "31" });
      for (const r of codes("40")) charges.push({ name: "Liittymän lisämaksu", unit: "month", price: r.hinta ?? 0, vat: 0, from: START, code: "40" });
      for (const r of codes("50")) charges.push({ name: "Jäsenmaksu", unit: "once", price: r.hinta ?? 0, vat: 0, from: periodMonth, code: "50" });
      for (const c of charges.filter((x) => x.price > 0)) {
        await tx.query(
          `insert into ml_property_charges (organization_id, property_id, name, unit, price_eur, vat_percent, price_includes_vat, valid_from, legacy_code)
           values ($1, $2, $3, $4, $5, $6, true, $7, $8)`,
          [org.id, property.id, c.name, c.unit, c.price, c.vat, c.from, c.code],
        );
        stats.charges++;
      }
      if (u.laina) {
        await tx.query(
          `insert into ml_property_loans (organization_id, property_id, balance_eur, balance_date, monthly_amortization_eur, interest_percent, final_month, notes)
           values ($1, $2, $3, $4, $5, 5, $6, $7)`,
          [org.id, property.id, u.laina.saldo, u.laina.saldopaiva, u.laina.lyhennys, u.laina.viimeinen_kk, u.laina.huom],
        );
        stats.loans++;
      }
    }
    await tx.query(
      "insert into ml_audit_log (organization_id, action, entity, details) values ($1, 'import.karkinen', 'ml_properties', $2)",
      [org.id, JSON.stringify(stats)],
    );
    if (dryRun) throw new Error("__kuiva__");
  });
} catch (err) {
  if (!(err instanceof Error && err.message === "__kuiva__")) {
    // Vain virheviesti: kannan virheolio sisältää kyselyn parametrit eli henkilötietoja.
    console.log(`Virhe: ${err instanceof Error ? err.message : "tuntematon"}`);
    await db.close();
    process.exit(1);
  }
  console.log("Kuivaharjoitus: mitään ei tallennettu.");
} finally {
  await db.close();
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

console.log(`Huoneistoja ${stats.units}: asiakkaita ${stats.customers}, käyttöpaikka yhdistetty ${stats.points}.`);
console.log(`Liittymiä: jätevesi ${stats.wastewater}, vesi ${stats.water}. Ilman liittymää ${stats.noConnection}, liittymä ilman kulutusarviota ${stats.noEstimate}.`);
console.log(`Kiinteistön maksuja ${stats.charges}, lainaosuuksia ${stats.loans}.`);
