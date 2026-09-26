import type { Sql } from "@/lib/db/types";
import type { BillingConnection, BillingMeter, BillingTariff, PropertyCharge, PropertyLoan } from "./calculate";

export interface PropertyBillingData {
  propertyId: string;
  legacyId: string | null;
  streetAddress: string;
  areaId: string | null;
  /** Käsin annettu vuosikulutusarvio (uusi liittymä, arviolaskutus; mittarittomalla sovittu vuosikulutus). */
  estimatedAnnualM3: number | null;
  /** Henkilöluku mittarittoman kiinteistön kulutukseen. */
  occupants: number | null;
  connections: BillingConnection[];
  meters: BillingMeter[];
  charges: PropertyCharge[];
  loans: PropertyLoan[];
}

/**
 * Organisaation laskennan tiedot kolmella kyselyllä: laskutusajo ja vertailu
 * käsittelevät satoja kiinteistöjä kerralla. Vain hyväksytyt lukemat.
 */
export async function loadOrgBillingData(
  tx: Sql,
  orgId: string,
): Promise<{ properties: Map<string, PropertyBillingData>; tariffs: BillingTariff[]; estimateBasis: "history" | "manual"; occupantM3PerYear: number }> {
  const props = await tx.query<{ id: string; legacy_id: string | null; street_address: string; area_id: string | null; estimated_annual_m3: string | null; occupants: number | null }>(
    "select id, legacy_id, street_address, area_id, estimated_annual_m3::text, occupants from ml_properties where organization_id = $1",
    [orgId],
  );
  const conns = await tx.query<{ id: string; property_id: string; kind: "water" | "wastewater"; fee_class: string | null; connected_on: string; disconnected_on: string | null }>(
    "select id, property_id, kind, fee_class, connected_on::text, disconnected_on::text from ml_connections where organization_id = $1",
    [orgId],
  );
  const meters = await tx.query<{
    id: string; connection_id: string; property_id: string; meter_number: string | null; installed_on: string; start_reading: string; removed_on: string | null;
    final_reading: string | null; multiplier: string; readings: { r: string; d: string }[] | null;
  }>(
    `select m.id, m.connection_id, k.property_id, m.meter_number, m.installed_on::text, m.start_reading::text, m.removed_on::text,
            m.final_reading::text, m.multiplier::text,
            (select json_agg(json_build_object('r', r.reading::text, 'd', r.read_on::text) order by r.read_on)
               from ml_readings r where r.meter_id = m.id and r.status = 'accepted') as readings
       from ml_meters m join ml_connections k on k.id = m.connection_id
      where m.organization_id = $1`,
    [orgId],
  );
  const tariffRows = await tx.query<{
    charge_type: BillingTariff["chargeType"]; connection_kind: "water" | "wastewater" | null; fee_class: string | null; area_id: string | null;
    name: string; unit: BillingTariff["unit"]; price_eur: string; vat_percent: string; valid_from: string; valid_to: string | null;
    price_includes_vat: boolean;
  }>(
    `select charge_type, connection_kind, fee_class, area_id, name, unit, price_eur::text, vat_percent::text, valid_from::text, valid_to::text,
            price_includes_vat
       from ml_tariffs where organization_id = $1`,
    [orgId],
  );
  const chargeRows = await tx.query<{
    property_id: string; name: string; unit: "month" | "once"; price_eur: string; vat_percent: string; price_includes_vat: boolean;
    valid_from: string; valid_to: string | null; product_id: string | null;
  }>(
    `select property_id, name, unit, price_eur::text, vat_percent::text, price_includes_vat, valid_from::text, valid_to::text, product_id
       from ml_property_charges where organization_id = $1 order by valid_from, name`,
    [orgId],
  );
  const loanRows = await tx.query<{
    property_id: string; balance_eur: string; balance_date: string; monthly_amortization_eur: string; interest_percent: string; final_month: string | null;
    debtor_customer_id: string | null;
  }>(
    `select property_id, balance_eur::text, balance_date::text, monthly_amortization_eur::text, interest_percent::text, final_month::text,
            debtor_customer_id
       from ml_property_loans where organization_id = $1 order by created_at, id`,
    [orgId],
  );
  const [org] = await tx.query<{ estimate_basis: "history" | "manual"; occupant_m3_per_year: string }>(
    "select estimate_basis, occupant_m3_per_year::text from ml_organizations where id = $1",
    [orgId],
  );

  const properties = new Map<string, PropertyBillingData>(
    props.map((p) => [p.id, {
        propertyId: p.id, legacyId: p.legacy_id, streetAddress: p.street_address, areaId: p.area_id,
        estimatedAnnualM3: p.estimated_annual_m3 === null ? null : Number(p.estimated_annual_m3), occupants: p.occupants,
        connections: [], meters: [], charges: [], loans: [],
      }]),
  );
  for (const c of conns) {
    properties.get(c.property_id)?.connections.push({
      id: c.id, kind: c.kind, feeClass: c.fee_class, connectedOn: c.connected_on, disconnectedOn: c.disconnected_on,
    });
  }
  for (const m of meters) {
    properties.get(m.property_id)?.meters.push({
      id: m.id,
      connectionId: m.connection_id,
      meterNumber: m.meter_number,
      installedOn: m.installed_on,
      startReading: Number(m.start_reading),
      removedOn: m.removed_on,
      finalReading: m.final_reading === null ? null : Number(m.final_reading),
      multiplier: Number(m.multiplier),
      readings: (m.readings ?? []).map((r) => ({ readOn: r.d, reading: Number(r.r) })),
    });
  }
  const tariffs: BillingTariff[] = tariffRows.map((t) => ({
    chargeType: t.charge_type, connectionKind: t.connection_kind, feeClass: t.fee_class, areaId: t.area_id, name: t.name, unit: t.unit,
    priceEur: Number(t.price_eur), vatPercent: Number(t.vat_percent), validFrom: t.valid_from, validTo: t.valid_to, priceIncludesVat: t.price_includes_vat,
  }));
  for (const c of chargeRows) {
    properties.get(c.property_id)?.charges.push({
      name: c.name, productId: c.product_id, unit: c.unit, priceEur: Number(c.price_eur), vatPercent: Number(c.vat_percent), priceIncludesVat: c.price_includes_vat,
      validFrom: c.valid_from, validTo: c.valid_to,
    });
  }
  for (const l of loanRows) {
    properties.get(l.property_id)?.loans.push({
      balance: Number(l.balance_eur), balanceDate: l.balance_date, monthlyAmortization: Number(l.monthly_amortization_eur),
      interestPercent: Number(l.interest_percent), finalMonth: l.final_month, debtorCustomerId: l.debtor_customer_id,
    });
  }
  return { properties, tariffs, estimateBasis: org?.estimate_basis ?? "history", occupantM3PerYear: Number(org?.occupant_m3_per_year ?? 40) };
}

/**
 * Mittarittoman kiinteistön sovittu vuosikulutus: annettu vuosikulutus, muuten
 * henkilöluku × organisaation kulutus asukasta kohden. Ilman kumpaakaan null.
 */
export function agreedAnnualM3(p: Pick<PropertyBillingData, "estimatedAnnualM3" | "occupants">, perOccupant: number): number | null {
  if (p.estimatedAnnualM3 !== null) return p.estimatedAnnualM3;
  if (p.occupants !== null) return Math.round(p.occupants * perOccupant * 1000) / 1000;
  return null;
}
