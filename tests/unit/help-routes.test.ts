import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { STAFF_NAV, STAFF_NAV_ORG } from "@/config/nav";
import { HELP_ROUTE_SLUGS, helpFor } from "@/lib/help/routes";
import { HELP_TOPICS } from "@/lib/help/topics";

/**
 * Jokaisella henkilökunnan sivulla on linkki ohjeeseen. Testi käy läpi kaikki
 * sivutiedostot, joten uusi toiminto ei voi jäädä ilman ohjetta
 * (CLAUDE.md, Ohjeet).
 */

const ROOT = join(process.cwd(), "src", "app", "(henkilokunta)");

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return pages(full);
    return name === "page.tsx" ? [full] : [];
  });
}

/** Sivutiedosto osoitteeksi: dynaamiset osat korvataan esimerkkiarvolla. */
const toPath = (file: string) =>
  "/" +
  relative(ROOT, file)
    .split(sep)
    .slice(0, -1)
    .map((part) => (part.startsWith("[") ? "00000000-0000-0000-0000-000000000000" : part))
    .join("/");

describe("ohjelinkit", () => {
  const all = pages(ROOT).map(toPath);

  it("löytää sivut", () => expect(all.length).toBeGreaterThan(20));

  for (const path of all) {
    it(`${path} osoittaa ohjeeseen`, () => {
      const help = helpFor(path);
      expect(help, `Lisää sivulle ohje tiedostoon src/lib/help/routes.ts`).not.toBeNull();
    });
  }

  it("valikon kohdat osoittavat ohjeeseen", () => {
    for (const item of [...STAFF_NAV, ...STAFF_NAV_ORG].filter((i) => i.href.startsWith("/") && !i.href.startsWith("/ohjeet"))) {
      expect(helpFor(item.href), item.href).not.toBeNull();
    }
  });

  it("kartan ohjeet ja osiot ovat olemassa", () => {
    for (const r of HELP_ROUTE_SLUGS) {
      const topic = HELP_TOPICS.find((t) => t.slug === r.slug);
      expect(topic, r.slug).toBeTruthy();
      if (r.section) expect(topic!.sections.map((s) => s.title), `${r.slug}: ${r.section}`).toContain(r.section);
    }
  });

  it("ohje vie osioon ankkurilla", () => {
    expect(helpFor("/hinnasto")).toEqual({ title: "Hinnasto", href: "/ohjeet/hinnasto" });
    expect(helpFor("/kiinteistot/abc/vuokralainen")?.href).toBe("/ohjeet/omistajanvaihdos#vuokralaisen-vaihdos");
    expect(helpFor("/mittarinvaihdot")?.href).toBe("/ohjeet/mittarinvaihto#vaihtokampanja");
  });
});
