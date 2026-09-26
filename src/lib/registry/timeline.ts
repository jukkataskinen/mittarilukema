import type { Sql } from "@/lib/db/types";

/**
 * Käyttöpaikan aikajana: sopimukset, liittymät, mittarit, lukemat, laskut ja
 * tapahtumat samalla janalla. Tapahtuma (esim. omistajanvaihdos) kokoaa
 * tekemänsä sopimus- ja mittarimuutokset, jottei samaa asiaa näytetä kahdesti.
 * Kaistat näyttävät, kuka oli osapuolena ja mikä mittari käytössä milloinkin.
 */

export type TimelineCategory = "contract" | "meter" | "reading" | "invoice" | "event";

export interface TimelineEntry {
  date: string;
  category: TimelineCategory;
  title: string;
  detail: string | null;
  tone: "neutral" | "info" | "ok" | "warn" | "alert";
  href: string | null;
  /** Järjestys saman päivän sisällä: tapahtuma ensin, sitten sopimukset ja mittarit. */
  order: number;
}

export interface Lane {
  key: string;
  label: string;
  segments: { from: string; to: string | null; label: string; href: string | null }[];
}

export interface TimelineData {
  contracts: { id: string; customer_id: string; customer_name: string; role: "owner" | "tenant"; billed: boolean; starts_on: string; ends_on: string | null; tenant_components: string[] }[];
  connections: { id: string; kind: "water" | "wastewater"; connected_on: string; disconnected_on: string | null }[];
  meters: { id: string; connection_kind: "water" | "wastewater"; meter_number: string | null; read_method: string; installed_on: string; start_reading: string; removed_on: string | null; final_reading: string | null }[];
  readings: { id: string; meter_number: string | null; read_on: string; reading: string; status: string; source: string }[];
  invoices: { id: string; run_id: string; kind: string; customer_name: string | null; period_start: string; period_end: string; gross_eur: string; status: string }[];
  events: { id: string; kind: string; event_date: string; notes: string | null; details: Record<string, unknown> }[];
  /** Tapahtumien osapuolten nimet, myös niiden, joilla ei enää ole sopimusta käyttöpaikalla. */
  people: { id: string; name: string }[];
}

const DAY = 86_400_000;
const addDay = (iso: string) => new Date(Date.parse(`${iso}T12:00:00Z`) + DAY).toISOString().slice(0, 10);
const fiDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${Number(d)}.${Number(m)}.${y}`;
};
const fiNum = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(Number(v)).replace(".", ","));
const CONN: Record<string, string> = { water: "vesi", wastewater: "jätevesi" };
const COMPONENT: Record<string, string> = { usage: "kulutus", basic_fee: "perusmaksut", other_fee: "muut maksut" };
const SOURCE: Record<string, string> = {
  remote: "etäluenta", sms: "tekstiviesti", reader: "mittarinlukija", staff: "toimisto", form: "asiakkaan ilmoitus", import: "tuonti", estimate: "arvio",
};
const RUN_KIND: Record<string, string> = { actual: "Lasku", estimate: "Arviolasku", settlement: "Tasauslasku" };

export function buildTimeline(d: TimelineData): { entries: TimelineEntry[]; lanes: Lane[] } {
  const names = new Map([...d.people.map((p) => [p.id, p.name] as const), ...d.contracts.map((c) => [c.customer_id, c.customer_name] as const)]);
  const meterNo = new Map(d.meters.map((m) => [m.id, m.meter_number ?? "numeroton"]));
  const covered = new Set<string>();
  const entries: TimelineEntry[] = [];
  const who = (id: unknown) => (typeof id === "string" ? (names.get(id) ?? "asiakas") : null);

  for (const e of d.events) {
    const x = e.details as Record<string, string | number | null | undefined>;
    for (const k of ["fromContractId", "toContractId", "endedTenantContractId", "oldMeterId", "newMeterId"]) if (typeof x[k] === "string") covered.add(`${k.includes("Meter") ? "m" : "c"}:${x[k]}`);
    let title = "";
    let detail: string[] = [];
    if (e.kind === "ownership_change") {
      title = "Omistajanvaihdos";
      detail = [`${who(x.fromCustomerId)} → ${who(x.toCustomerId)}`];
      if (x.loanDecision) detail.push(x.loanDecision === "transfers" ? "laina siirtyi ostajalle" : "laina jäi myyjälle");
      if (x.endedTenantContractId) detail.push("käyttösopimus päättyi");
    } else if (e.kind === "tenant_in" || e.kind === "tenant_out") {
      title = e.kind === "tenant_in" ? "Vuokralaisen vaihdos" : "Vuokralainen muutti pois";
      detail = [[who(x.fromCustomerId), who(x.toCustomerId)].some(Boolean) ? `${who(x.fromCustomerId) ?? "–"} → ${who(x.toCustomerId) ?? "–"}` : ""];
    } else if (e.kind === "meter_change") {
      title = "Mittarinvaihto";
      detail = [`${x.oldMeterNumber ?? "numeroton"} (loppu ${fiNum(x.finalReading)}) → ${x.newMeterNumber ?? ""} (alku ${fiNum(x.startReading)})`];
      if (x.source === "campaign") detail.push("vaihtokampanja");
    } else title = e.kind;
    if (e.notes) detail.push(e.notes);
    entries.push({ date: e.event_date, category: "event", title, detail: detail.filter(Boolean).join(" · ") || null, tone: "info", href: null, order: 0 });
  }

  for (const c of d.contracts) {
    const type = c.role === "owner" ? "Liittymissopimus" : "Käyttösopimus";
    const parts = c.role === "tenant" ? `vuokralainen maksaa: ${c.tenant_components.map((k) => COMPONENT[k] ?? k).join(", ")}` : "omistaja";
    const href = `/asiakkaat/${c.customer_id}`;
    // Tapahtuman tekemä sopimusmuutos näkyy tapahtumassa; alkava sopimus on vaihtopäivää seuraavana päivänä.
    if (!covered.has(`c:${c.id}`)) {
      entries.push({ date: c.starts_on, category: "contract", title: `${type} alkoi: ${c.customer_name}`, detail: c.billed ? parts : `${parts}, ei laskuteta`, tone: "neutral", href, order: 1 });
      if (c.ends_on) entries.push({ date: c.ends_on, category: "contract", title: `${type} päättyi: ${c.customer_name}`, detail: null, tone: "neutral", href, order: 1 });
    }
  }
  for (const k of d.connections) {
    entries.push({ date: k.connected_on, category: "meter", title: `Liittymä (${CONN[k.kind]}) liitettiin`, detail: null, tone: "neutral", href: null, order: 2 });
    if (k.disconnected_on) entries.push({ date: k.disconnected_on, category: "meter", title: `Liittymä (${CONN[k.kind]}) päättyi`, detail: null, tone: "warn", href: null, order: 2 });
  }
  for (const m of d.meters) {
    if (covered.has(`m:${m.id}`)) continue;
    entries.push({
      date: m.installed_on, category: "meter", title: `Mittari ${m.meter_number ?? "numeroton"} asennettiin`,
      detail: `${CONN[m.connection_kind]}, aloituslukema ${fiNum(m.start_reading)}`, tone: "neutral", href: null, order: 2,
    });
    if (m.removed_on) {
      entries.push({ date: m.removed_on, category: "meter", title: `Mittari ${m.meter_number ?? "numeroton"} poistettiin`, detail: `loppulukema ${fiNum(m.final_reading)}`, tone: "neutral", href: null, order: 2 });
    }
  }
  for (const r of d.readings) {
    const st = r.status === "needs_review" ? " (tarkistettava)" : "";
    entries.push({
      date: r.read_on, category: "reading", title: `Lukema ${fiNum(r.reading)}${st}`, detail: `mittari ${r.meter_number ?? "numeroton"}, ${SOURCE[r.source] ?? r.source}`,
      tone: r.status === "needs_review" ? "warn" : "neutral", href: null, order: 3,
    });
  }
  for (const i of d.invoices) {
    entries.push({
      date: i.period_end, category: "invoice", title: `${RUN_KIND[i.kind] ?? "Lasku"} ${fiDate(addDay(i.period_start))} – ${fiDate(i.period_end)}`,
      detail: `${i.customer_name ?? "ei maksajaa"}, ${fiNum(i.gross_eur)} €${i.status === "excluded" ? ", jätetty pois" : ""}`,
      tone: i.status === "excluded" ? "neutral" : "ok", href: `/laskutus/${i.run_id}/${i.id}`, order: 4,
    });
  }
  entries.sort((a, b) => b.date.localeCompare(a.date) || a.order - b.order);

  const lane = (role: "owner" | "tenant", label: string): Lane => ({
    key: role, label,
    segments: d.contracts
      .filter((c) => c.role === role && c.billed)
      .sort((a, b) => a.starts_on.localeCompare(b.starts_on))
      .map((c) => ({ from: c.starts_on, to: c.ends_on, label: c.customer_name, href: `/asiakkaat/${c.customer_id}` })),
  });
  const meterLanes: Lane[] = (["water", "wastewater"] as const)
    .map((kind) => ({
      key: `meter-${kind}`, label: `Mittari (${CONN[kind]})`,
      segments: d.meters
        .filter((m) => m.connection_kind === kind)
        .sort((a, b) => a.installed_on.localeCompare(b.installed_on))
        .map((m) => ({ from: m.installed_on, to: m.removed_on, label: meterNo.get(m.id) ?? "", href: null })),
    }))
    .filter((l) => l.segments.length > 0);
  return { entries, lanes: [lane("owner", "Omistaja"), lane("tenant", "Vuokralainen"), ...meterLanes] };
}

export async function loadTimeline(tx: Sql, orgId: string, propertyId: string): Promise<TimelineData | null> {
  const [p] = await tx.query("select 1 from ml_properties where organization_id = $1 and id = $2", [orgId, propertyId]);
  if (!p) return null;
  const contracts = await tx.query<TimelineData["contracts"][number]>(
    `select c.id, c.customer_id, cu.name as customer_name, c.role, c.billed, c.starts_on::text, c.ends_on::text, c.tenant_components
       from ml_contracts c join ml_customers cu on cu.id = c.customer_id where c.property_id = $1`,
    [propertyId],
  );
  const connections = await tx.query<TimelineData["connections"][number]>(
    "select id, kind, connected_on::text, disconnected_on::text from ml_connections where property_id = $1",
    [propertyId],
  );
  const meters = await tx.query<TimelineData["meters"][number]>(
    `select m.id, k.kind as connection_kind, m.meter_number, m.read_method, m.installed_on::text, m.start_reading::text, m.removed_on::text, m.final_reading::text
       from ml_meters m join ml_connections k on k.id = m.connection_id where k.property_id = $1`,
    [propertyId],
  );
  const readings = await tx.query<TimelineData["readings"][number]>(
    `select r.id, m.meter_number, r.read_on::text, r.reading::text, r.status, r.source
       from ml_readings r join ml_meters m on m.id = r.meter_id join ml_connections k on k.id = m.connection_id
      where k.property_id = $1 and r.status <> 'rejected'`,
    [propertyId],
  );
  const invoices = await tx.query<TimelineData["invoices"][number]>(
    `select i.id, i.run_id, r.kind, cu.name as customer_name, i.period_start::text, i.period_end::text, i.gross_eur::text, i.status
       from ml_invoices i join ml_billing_runs r on r.id = i.run_id left join ml_customers cu on cu.id = i.customer_id
      where i.property_id = $1 and r.status = 'approved'`,
    [propertyId],
  );
  const events = await tx.query<TimelineData["events"][number]>(
    "select id, kind, event_date::text, notes, details from ml_property_events where property_id = $1",
    [propertyId],
  );
  const ids = [...new Set(events.flatMap((e) => [e.details.fromCustomerId, e.details.toCustomerId]).filter((v): v is string => typeof v === "string"))];
  const people = ids.length ? await tx.query<{ id: string; name: string }>("select id, name from ml_customers where id = any($1::uuid[])", [ids]) : [];
  return { contracts, connections, meters, readings, invoices, events, people };
}
