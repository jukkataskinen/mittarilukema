import type { Sql } from "@/lib/db/types";
import type { BillingLine } from "@/lib/billing/calculate";

/**
 * Tuoterekisteri (0024): laskurivin tuote, kirjanpitotili ja laskentakohde.
 * Tuote valitaan säännöillä: tyhjä ehto sopii kaikkiin, ja riville valitaan
 * tuote, jonka ehdoista mahdollisimman moni osuu. Kiinteistön oma maksu voi
 * osoittaa suoraan tuotteeseen.
 */

export interface Product {
  id: string;
  code: string;
  name: string;
  accountCode: string | null;
  costCenterCode: string | null;
  autoMatch: boolean;
  active: boolean;
  match: {
    chargeType: string | null;
    connectionKind: string | null;
    feeClass: string | null;
    areaId: string | null;
    customerGroup: string | null;
    metered: boolean | null;
  };
}

export interface LineContext {
  areaId: string | null;
  customerGroup: string | null;
  metered: boolean;
}

export interface ResolvedProduct {
  productCode: string | null;
  accountCode: string | null;
  costCenterCode: string | null;
}

export const CHARGE_TYPE_OF_LINE = (l: Pick<BillingLine, "kind" | "chargeType">): string =>
  l.kind === "usage" ? "usage_fee" : l.kind === "basic_fee" ? "basic_fee" : (l.chargeType ?? "other");

/** Rivin tuote. Palauttaa null, jos yksikään automaattinen tuote ei sovi. */
export function resolveProduct(products: Product[], line: BillingLine, ctx: LineContext): Product | null {
  if (line.productId) return products.find((p) => p.id === line.productId) ?? null;
  const facts = {
    chargeType: CHARGE_TYPE_OF_LINE(line),
    connectionKind: line.connectionKind,
    feeClass: line.feeClass ?? null,
    areaId: ctx.areaId,
    customerGroup: ctx.customerGroup ? ctx.customerGroup.toLowerCase() : null,
    metered: ctx.metered,
  };
  let best: { p: Product; score: number } | null = null;
  for (const p of products) {
    if (!p.autoMatch || !p.active) continue;
    let score = 0;
    let ok = true;
    for (const key of Object.keys(p.match) as (keyof Product["match"])[]) {
      const want = p.match[key];
      if (want === null) continue;
      const have = key === "customerGroup" && typeof want === "string" ? want.toLowerCase() : want;
      if (facts[key] !== have) {
        ok = false;
        break;
      }
      score++;
    }
    // Tasatilanteessa pienin tuotekoodi, jotta valinta on toistettava.
    if (ok && (!best || score > best.score || (score === best.score && p.code < best.p.code))) best = { p, score };
  }
  return best?.p ?? null;
}

export function toResolved(p: Product | null): ResolvedProduct {
  return { productCode: p?.code ?? null, accountCode: p?.accountCode ?? null, costCenterCode: p?.costCenterCode ?? null };
}

export async function loadProducts(tx: Sql, orgId: string): Promise<Product[]> {
  const rows = await tx.query<{
    id: string; code: string; name: string; account_code: string | null; cost_center_code: string | null; auto_match: boolean; active: boolean;
    match_charge_type: string | null; match_connection_kind: string | null; match_fee_class: string | null; match_area_id: string | null;
    match_customer_group: string | null; match_metered: boolean | null;
  }>(
    `select p.id, p.code, p.name, a.code as account_code, c.code as cost_center_code, p.auto_match, p.active, p.match_charge_type,
            p.match_connection_kind, p.match_fee_class, p.match_area_id, p.match_customer_group, p.match_metered
       from ml_products p left join ml_accounts a on a.id = p.account_id left join ml_cost_centers c on c.id = p.cost_center_id
      where p.organization_id = $1`,
    [orgId],
  );
  return rows.map((r) => ({
    id: r.id, code: r.code, name: r.name, accountCode: r.account_code, costCenterCode: r.cost_center_code, autoMatch: r.auto_match, active: r.active,
    match: {
      chargeType: r.match_charge_type, connectionKind: r.match_connection_kind, feeClass: r.match_fee_class, areaId: r.match_area_id,
      customerGroup: r.match_customer_group, metered: r.match_metered,
    },
  }));
}

export const MATCH_LABEL = {
  chargeType: { usage_fee: "Käyttömaksu", basic_fee: "Perusmaksu", extra_basic_fee: "Lisäperusmaksu", loan_share: "Lainaosuus", other: "Muu maksu" } as Record<string, string>,
  connectionKind: { water: "Vesi", wastewater: "Jätevesi" } as Record<string, string>,
};
