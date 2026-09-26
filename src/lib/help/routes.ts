import { HELP_TOPICS, sectionId } from "./topics";

/**
 * Sovelluksen sivut ja niiden ohjeet. Henkilökunnan kehys näyttää jokaisella
 * sivulla linkin sivun ohjeeseen tämän kartan perusteella. Tarkempi sääntö on
 * ensin. Uusi sivu lisätään tähän samassa muutoksessa: testi
 * tests/unit/help-routes.test.ts käy läpi kaikki henkilökunnan sivut ja kaatuu,
 * jos jollekin puuttuu ohje.
 */
const ROUTES: { pattern: RegExp; slug: string; section?: string }[] = [
  { pattern: /^\/tyopoyta/, slug: "tyopoyta" },
  { pattern: /^\/kiinteistot\/[^/]+\/omistajanvaihdos/, slug: "omistajanvaihdos", section: "Omistajanvaihdos" },
  { pattern: /^\/kiinteistot\/[^/]+\/vuokralainen/, slug: "omistajanvaihdos", section: "Vuokralaisen vaihdos" },
  { pattern: /^\/kiinteistot\/[^/]+\/mittarinvaihto/, slug: "mittarinvaihto", section: "Yksittäinen vaihto" },
  { pattern: /^\/kiinteistot\/[^/]+\/aikajana/, slug: "aikajana" },
  { pattern: /^\/kiinteistot/, slug: "rekisteri" },
  { pattern: /^\/asiakkaat\/[^/]+$/, slug: "lahetysloki" },
  { pattern: /^\/asiakkaat/, slug: "rekisteri", section: "Asiakkaat" },
  { pattern: /^\/lukemat/, slug: "lukemat" },
  { pattern: /^\/mittarinvaihdot/, slug: "mittarinvaihto", section: "Vaihtokampanja" },
  { pattern: /^\/muutosilmoitukset/, slug: "muutosilmoitus", section: "Ilmoituksen käsittely" },
  { pattern: /^\/laskutus\/[^/]+\/[^/]+/, slug: "laskukanava" },
  { pattern: /^\/laskutus/, slug: "laskutus", section: "Laskutusajo" },
  { pattern: /^\/tiedotteet/, slug: "tiedotteet" },
  { pattern: /^\/hinnasto/, slug: "hinnasto" },
  { pattern: /^\/asetukset/, slug: "asetukset" },
];

/** Sivun ohje: otsikko ja osoite (osioon asti, jos sivu vastaa ohjeen osiota). */
export function helpFor(pathname: string): { title: string; href: string } | null {
  const route = ROUTES.find((r) => r.pattern.test(pathname));
  const topic = route ? HELP_TOPICS.find((t) => t.slug === route.slug) : null;
  if (!route || !topic) return null;
  const section = route.section && topic.sections.some((s) => s.title === route.section) ? `#${sectionId(route.section)}` : "";
  return { title: topic.title, href: `/ohjeet/${topic.slug}${section}` };
}

export const HELP_ROUTE_SLUGS = ROUTES.map((r) => ({ slug: r.slug, section: r.section ?? null }));
