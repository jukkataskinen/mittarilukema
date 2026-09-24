import { readFile, writeFile } from "node:fs/promises";
import { openTargetDb } from "./lib/target-db.mts";
import { calculateBill } from "../src/lib/billing/calculate.ts";
import { loadOrgBillingData } from "../src/lib/billing/load.ts";
import { JOUTSA_PERIOD_BY_INVOICE_MONTH as PERIOD_BY_MONTH } from "../src/lib/import/fennoa.ts";

/**
 * Vertailu: Fennoan myyntilaskut lasketaan uudelleen laskentamoottorilla.
 *
 *   npm run vertaa:laskut [-- --tuotanto]
 *
 * Jakso otetaan laskun lukemariviltä, tai laskupäivästä: toukokuun laskut
 * 30.9.2025–31.3.2026, elokuun (Rutalahti) 31.12.2025–30.6.2026.
 * Tulos: yhteenveto näytölle, rivikohtainen CSV data/private/fennoa/vertailu.csv
 * (sisältää asiakastietoja, ei versionhallintaan).
 */

interface Row { tuote: string; lkm: number | null; hinta: number | null; veroton: number | null }
interface Inv {
  laskunro: string | null; asiakasnro: string | null; laskupvm: string | null; tyyppi: string; tiedosto: string;
  laskutus: { nimi: string | null }; rivit: Row[]; lukemat: { unes: string | null; jakso_alku?: string | null; jakso_loppu?: string | null; muoto: string }[];
}

const args = process.argv.slice(2);
const ORG = "Joutsan Vesihuolto Oy";
const invoices: Inv[] = JSON.parse(await readFile("data/private/fennoa/invoices.json", "utf8"));

const cat = (t: string) => {
  const s = t.toLowerCase();
  if (s.includes("perusmaksu")) return s.includes("jäte") ? "pmJate" : "pmVesi";
  if (s.includes("jäte")) return "jate";
  if (/^(vesi|kylmävesi|veden)/.test(s)) return "vesi";
  return "muu";
};
const r2 = (n: number) => Math.round(n * 100) / 100;

const db = await openTargetDb(args);
const out: string[][] = [];
const stats = new Map<string, number>();
const bump = (k: string) => stats.set(k, (stats.get(k) ?? 0) + 1);
const diffs = { vesi: 0, jate: 0, pmVesi: 0, pmJate: 0 };

try {
  await db.asService(async (tx) => {
    const [org] = await tx.query<{ id: string }>("select id from ml_organizations where name = $1", [ORG]);
    const { properties, tariffs } = await loadOrgBillingData(tx, org.id);
    const byLegacy = new Map([...properties.values()].filter((p) => p.legacyId).map((p) => [p.legacyId!, p]));
    const perProperty = new Map<string, number>();

    const candidates = invoices.filter((i) => i.tyyppi === "Lasku" && i.rivit.some((r) => cat(r.tuote) !== "muu"));
    for (const i of candidates) {
      const unes = i.lukemat.find((r) => r.unes)?.unes;
      if (unes) perProperty.set(unes, (perProperty.get(unes) ?? 0) + 1);
    }
    for (const i of candidates) {
      const unes = i.lukemat.find((r) => r.unes)?.unes ?? null;
      const withPeriod = i.lukemat.find((r) => r.jakso_alku && r.jakso_loppu);
      const period: [string, string] | undefined = withPeriod
        ? [withPeriod.jakso_alku!, withPeriod.jakso_loppu!]
        : PERIOD_BY_MONTH[(i.laskupvm ?? "").slice(0, 7)];
      const base = [i.laskunro ?? "", i.laskupvm ?? "", i.asiakasnro ?? "", i.laskutus.nimi ?? "", unes ?? ""];
      if (!unes || !byLegacy.has(unes)) {
        bump("ei kiinteistöä (lukemassa ei käyttöpaikkaa)");
        out.push([...base, "", "", "ei kiinteistöä"]);
        continue;
      }
      if (!period) {
        bump("jakso ei tiedossa (yksittäinen lasku)");
        out.push([...base, "", "", "jakso ei tiedossa"]);
        continue;
      }
      const p = byLegacy.get(unes)!;
      const res = calculateBill({ periodStart: period[0], periodEnd: period[1], areaId: p.areaId, connections: p.connections, meters: p.meters, tariffs });
      const theirs = { vesi: 0, jate: 0, pmVesi: 0, pmJate: 0, muu: 0, net: 0 };
      for (const r of i.rivit) {
        const c = cat(r.tuote);
        if (c === "vesi" || c === "jate") theirs[c] += r.lkm ?? 0;
        else if (c === "pmVesi" || c === "pmJate" || c === "muu") theirs[c] += r.veroton ?? 0;
        if (c !== "muu") theirs.net += r.veroton ?? 0;
      }
      const ours = {
        vesi: res.waterM3,
        jate: res.wastewaterM3,
        pmVesi: r2(res.lines.filter((l) => l.kind === "basic_fee" && l.connectionKind === "water").reduce((s, l) => s + l.net, 0)),
        pmJate: r2(res.lines.filter((l) => l.kind === "basic_fee" && l.connectionKind === "wastewater").reduce((s, l) => s + l.net, 0)),
      };
      const reasons: string[] = [];
      if (Math.abs(ours.vesi - theirs.vesi) > 0.001) { reasons.push("vesi m3"); diffs.vesi++; }
      if (Math.abs(ours.jate - theirs.jate) > 0.001) { reasons.push("jätevesi m3"); diffs.jate++; }
      if (Math.abs(ours.pmVesi - r2(theirs.pmVesi)) > 0.005) { reasons.push("veden perusmaksu"); diffs.pmVesi++; }
      if (Math.abs(ours.pmJate - r2(theirs.pmJate)) > 0.005) { reasons.push("jäteveden perusmaksu"); diffs.pmJate++; }
      const same = Math.abs(res.net - r2(theirs.net)) < 0.01;
      const status = same ? "täsmää" : perProperty.get(unes)! > 1 ? "eroaa, kiinteistöllä useampi lasku" : "eroaa";
      bump(status);
      out.push([
        ...base, period[0], period[1], status, reasons.join(", "), res.issues.join(" "),
        String(theirs.vesi), String(ours.vesi), String(theirs.jate), String(ours.jate),
        r2(theirs.pmVesi).toFixed(2), ours.pmVesi.toFixed(2), r2(theirs.pmJate).toFixed(2), ours.pmJate.toFixed(2),
        r2(theirs.net).toFixed(2), res.net.toFixed(2), r2(res.net - theirs.net).toFixed(2), r2(theirs.muu).toFixed(2),
      ]);
    }
  });
} finally {
  await db.close();
}

const header = ["Laskunro", "Laskupäivä", "Asiakasnro", "Asiakas", "Unes", "Jakso alkaa", "Jakso päättyy", "Tulos", "Eroavat osat", "Huomautukset",
  "Vesi m3 Fennoa", "Vesi m3 uusi", "Jätevesi m3 Fennoa", "Jätevesi m3 uusi", "Veden PM Fennoa", "Veden PM uusi", "Jäteveden PM Fennoa", "Jäteveden PM uusi",
  "Veroton Fennoa", "Veroton uusi", "Erotus", "Muut rivit Fennoa"];
const csv = "﻿" + [header, ...out].map((r) => r.map((c) => (/[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(";")).join("\n");
await writeFile("data/private/fennoa/vertailu.csv", csv.replace(/(\d)\.(\d)/g, "$1,$2"), "utf8");

console.log("Laskut: " + [...stats].map(([k, v]) => `${k} ${v}`).join(", "));
console.log(`Eroavat osat: vesi ${diffs.vesi}, jätevesi ${diffs.jate}, veden perusmaksu ${diffs.pmVesi}, jäteveden perusmaksu ${diffs.pmJate}.`);
console.log("Rivikohtaisesti: data/private/fennoa/vertailu.csv");
