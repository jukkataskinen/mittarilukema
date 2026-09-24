/** Käyttöliittymän nimet tietokannan koodiarvoille. */

export const CONNECTION_KIND: Record<string, string> = { water: "Vesi", wastewater: "Jätevesi" };
export const READ_METHOD: Record<string, string> = { remote: "Etäluettava", mechanical: "Mekaaninen" };
export const CONTRACT_ROLE: Record<string, string> = { owner: "Omistaja", tenant: "Vuokralainen" };
export const CUSTOMER_KIND: Record<string, string> = { person: "Henkilö", company: "Yritys tai yhteisö" };
export const BILLING_METHOD: Record<string, string> = {
  actual: "Toteutunut kulutus",
  estimate: "Arviolasku ja vuositasaus",
};
export const READING_SOURCE: Record<string, string> = {
  remote: "Etäluenta",
  sms: "Tekstiviesti",
  reader: "Lukija",
  staff: "Toimisto",
  form: "Lomake",
  import: "Tuonti",
  estimate: "Arvio",
};
export const READING_STATUS: Record<string, string> = {
  accepted: "Hyväksytty",
  needs_review: "Tarkistettava",
  rejected: "Hylätty",
};
export const CHARGE_TYPE: Record<string, string> = {
  basic_fee: "Perusmaksu",
  usage_fee: "Käyttömaksu",
  loan_share: "Lainaosuus",
  extra_basic_fee: "Lisäperusmaksu",
  other: "Muu",
};
export const TARIFF_UNIT: Record<string, string> = { m3: "€/m³", month: "€/kk", year: "€/v", piece: "€/kpl" };
export const MONTHS = ["tammi", "helmi", "maalis", "huhti", "touko", "kesä", "heinä", "elo", "syys", "loka", "marras", "joulu"];
