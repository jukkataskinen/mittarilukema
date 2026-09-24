import type { Sql } from "@/lib/db/types";
import type { BillingConnection, BillingMeter, BillingTariff } from "./calculate";

export interface PropertyBillingData {
  propertyId: string;
  legacyId: string | null;
  streetAddress: string;
  areaId: string | null;
  connections: BillingConnection[];
  meters: BillingMeter[];
}

/**
 * Organisaation laskennan tiedot kolmella kyselyllä: laskutusajo ja vertailu
 * käsittelevät satoja kiinteistöjä kerralla. Vain hyväksytyt lukemat.
 */
export async function loadOrgBillingData(tx: Sql, orgId: string): Promise<{ properties: Map<string, PropertyBillingData>; tariffs: BillingTariff[] }> {
  const props = await tx.query<{ id: string; legacy_id: string | null; street_address: string; area_id: string | null }>(
    "select id, legacy_id, street_address, area_id from ml_properties where organization_id = $1",
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
  }>(
    `select charge_type, connection_kind, fee_class, area_id, name, unit, price_eur::text, vat_percent::text, valid_from::text, valid_to::text
       from ml_tariffs where organization_id = $1`,
    [orgId],
  );

  const properties = new Map<string, PropertyBillingData>(
    props.map((p) => [p.id, { propertyId: p.id, legacyId: p.legacy_id, streetAddress: p.street_address, areaId: p.area_id, connections: [], meters: [] }]),
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
    priceEur: Number(t.price_eur), vatPercent: Number(t.vat_percent), validFrom: t.valid_from, validTo: t.valid_to,
  }));
  return { properties, tariffs };
}
