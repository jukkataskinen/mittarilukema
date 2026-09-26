import type { BillingLine, PropertyLoan } from "./calculate";

/**
 * Laskun osapuolet käyttöpaikalla (DECISIONS 26.9.2026):
 *   - liittymissopimus (role owner): omistaja maksaa kaiken, mitä käyttösopimus ei siirrä
 *   - käyttösopimus (role tenant): vuokralainen maksaa sopimukseen merkityt osat (yleensä kulutus)
 *   - lainaosuus: lainan velallinen, oletuksena omistaja; omistajanvaihdoksessa myyjä,
 *     kunnes kauppakirja osoittaa lainan siirtyneen
 * Saman jakson rivit jaetaan näin useammalle laskulle.
 */

export type ContractRole = "owner" | "tenant";
export type TenantComponent = "usage" | "basic_fee" | "other_fee";
export const TENANT_COMPONENTS: TenantComponent[] = ["usage", "basic_fee", "other_fee"];
export const TENANT_COMPONENT_LABEL: Record<TenantComponent, string> = {
  usage: "Kulutusmaksut",
  basic_fee: "Perusmaksut",
  other_fee: "Muut maksut",
};

export interface PartyContract {
  id: string;
  customer_id: string;
  role: ContractRole;
  starts_on: string;
  ends_on: string | null;
  tenant_components: string[];
}

const DAY = 86_400_000;
const addDay = (iso: string) => new Date(Date.parse(`${iso}T12:00:00Z`) + DAY).toISOString().slice(0, 10);
const dayBefore = (iso: string) => new Date(Date.parse(`${iso}T12:00:00Z`) - DAY).toISOString().slice(0, 10);

/** Päivänä voimassa olevat laskutettavat sopimukset. Parametrina vain laskutettavat. */
export function partiesOn(contracts: PartyContract[], date: string): { owner: PartyContract | null; tenant: PartyContract | null } {
  const on = (role: ContractRole) => contracts.find((c) => c.role === role && c.starts_on <= date && (c.ends_on === null || c.ends_on >= date)) ?? null;
  return { owner: on("owner"), tenant: on("tenant") };
}

/**
 * Jakson (start, end] sisäiset päivät, joiden jälkeen osapuolet vaihtuvat.
 * Palauttaa osajaksojen loppupäivät ilman jakson loppua: sopimus, joka alkaa
 * 15.5., tuottaa rajan 14.5.; sopimus, joka päättyy 14.5., samoin.
 */
export function changeBoundaries(contracts: PartyContract[], start: string, end: string): string[] {
  const first = addDay(start);
  const out = new Set<string>();
  for (const c of contracts) {
    if (c.starts_on > first && c.starts_on <= end) out.add(dayBefore(c.starts_on));
    if (c.ends_on !== null && c.ends_on >= first && c.ends_on < end) out.add(c.ends_on);
  }
  return [...out].sort();
}

export interface PartyInvoice {
  customerId: string | null;
  contractId: string | null;
  role: ContractRole | "debtor" | null;
  lines: BillingLine[];
  /** Laskulla on kulutusrivejä: lukemat, kulutus ja huomautukset kuuluvat tälle laskulle. */
  primary: boolean;
}

/**
 * Jakaa jakson rivit osapuolille. Rivien järjestys säilyy laskulla. Jos
 * liittymissopimus puuttuu, omistajan osuus laskutetaan vuokralaiselta ja
 * siitä tulee huomautus, jottei rivejä katoa.
 */
export function splitByParty(
  lines: BillingLine[],
  parties: { owner: PartyContract | null; tenant: PartyContract | null },
  loans: PropertyLoan[],
  allContracts: PartyContract[],
): { invoices: PartyInvoice[]; issues: string[] } {
  const { owner, tenant } = parties;
  const issues: string[] = [];
  const groups = new Map<string, PartyInvoice>();
  const groupFor = (customerId: string | null, contractId: string | null, role: PartyInvoice["role"]) => {
    const key = customerId ?? "";
    let g = groups.get(key);
    if (!g) {
      g = { customerId, contractId, role, lines: [], primary: false };
      groups.set(key, g);
    }
    return g;
  };
  // Omistaja ja vuokralainen ensin, jotta laskujen järjestys on vakaa.
  if (owner) groupFor(owner.customer_id, owner.id, "owner");
  if (tenant) groupFor(tenant.customer_id, tenant.id, "tenant");

  const fallback = owner ?? tenant;
  let ownerShareToTenant = false;
  for (const l of lines) {
    if (l.loanIndex !== undefined) {
      const debtor = loans[l.loanIndex]?.debtorCustomerId ?? null;
      if (debtor && debtor !== owner?.customer_id) {
        // Myyjä maksaa lainaa edelleen: viitataan hänen viimeisimpään liittymissopimukseensa.
        const own = allContracts.filter((c) => c.customer_id === debtor && c.role === "owner").sort((x, y) => y.starts_on.localeCompare(x.starts_on))[0];
        groupFor(debtor, own?.id ?? null, "debtor").lines.push(l);
        continue;
      }
      if (!owner && tenant) ownerShareToTenant = true;
      groupFor(fallback?.customer_id ?? null, fallback?.id ?? null, fallback?.role ?? null).lines.push(l);
      continue;
    }
    if (tenant && tenant.tenant_components.includes(l.kind)) {
      groupFor(tenant.customer_id, tenant.id, "tenant").lines.push(l);
      continue;
    }
    if (!owner && tenant) ownerShareToTenant = true;
    groupFor(fallback?.customer_id ?? null, fallback?.id ?? null, fallback?.role ?? null).lines.push(l);
  }
  if (ownerShareToTenant) issues.push("Liittymissopimus puuttuu: omistajan osuus laskutettiin vuokralaiselta. Kirjaa omistaja käyttöpaikalle.");

  let invoices = [...groups.values()].filter((g) => g.lines.length > 0);
  if (invoices.length === 0) invoices = [groups.values().next().value ?? { customerId: null, contractId: null, role: null, lines: [], primary: false }];
  const primary = invoices.find((g) => g.lines.some((l) => l.kind === "usage")) ?? invoices[0];
  primary.primary = true;
  return { invoices, issues };
}
