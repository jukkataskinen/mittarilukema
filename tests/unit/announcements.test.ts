import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { addressLines, composeEmail, decideChannel, type RecipientCustomer } from "@/lib/announcements";
import { buildLettersPdf } from "@/lib/announcements/letter";

const c = (over: Partial<RecipientCustomer> = {}): RecipientCustomer => ({
  customer_id: "x", name: "Testi Asiakas", email: "testi@example.fi", billing_street: "Testitie 1", billing_postal_code: "41800", billing_city: "Korpilahti", ...over,
});
const org = { name: "Kuvitelman vesiosuuskunta", contact_email: "toimisto@example.fi", contact_phone: "040 123 4567", postal_street: "Pumppaamontie 2", postal_code: "41800", postal_city: "Korpilahti" };

describe("tiedotteen toimitustapa", () => {
  it("sähköposti ensin, kirje jos sähköpostia ei ole", () => {
    expect(decideChannel(c(), "email_first")).toBe("email");
    expect(decideChannel(c({ email: null }), "email_first")).toBe("letter");
    expect(decideChannel(c({ email: "ei-osoite" }), "email_first")).toBe("letter");
    expect(decideChannel(c({ email: null, billing_postal_code: null }), "email_first")).toBe("none");
  });
  it("kaikille kirje, sähköposti vain jos osoite puuttuu", () => {
    expect(decideChannel(c(), "letter_all")).toBe("letter");
    expect(decideChannel(c({ billing_street: null }), "letter_all")).toBe("email");
  });
  it("osoiterivit: postitoimipaikka isoin kirjaimin", () => {
    expect(addressLines(c())).toEqual(["Testi Asiakas", "Testitie 1", "41800 KORPILAHTI"]);
    expect(addressLines(c({ billing_postal_code: "418" }))).toEqual([]);
  });
});

describe("sähköposti", () => {
  it("teksti kappaleina, allekirjoitus ja HTML suojattu", () => {
    const m = composeEmail({ title: "Hinnat <muuttuvat>", body: "Ensimmäinen kappale.\n\nToinen & viimeinen." }, org);
    expect(m.subject).toBe("Hinnat <muuttuvat>");
    expect(m.text).toContain("Toinen & viimeinen.\n\nKuvitelman vesiosuuskunta\nPumppaamontie 2, 41800 Korpilahti\n040 123 4567 · toimisto@example.fi");
    expect(m.html).toContain("Hinnat &lt;muuttuvat&gt;");
    expect(m.html).toContain("Toinen &amp; viimeinen.");
    expect(m.html.match(/<p style="margin:0 0 14px">/g)).toHaveLength(2);
  });
});

describe("ikkunakirjeet", () => {
  it("yksi sivu kirjettä kohden, pitkä teksti jatkuu seuraavalle sivulle", async () => {
    const pdf = await buildLettersPdf(
      org,
      { title: "Tiedote", body: Array.from({ length: 80 }, (_, i) => `Kappale ${i + 1}: vesimaksut ja lukemat.`).join("\n\n") },
      [{ name: "A", address_lines: ["A", "Tie 1", "41800 KORPILAHTI"] }, { name: "B", address_lines: ["B", "Tie 2", "41800 KORPILAHTI"] }],
      { date: "25.9.2026" },
    );
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(4);
    expect(doc.getPageCount() % 2).toBe(0);
  });
  it("fontista puuttuva merkki ei kaada tulostusta", async () => {
    const pdf = await buildLettersPdf(org, { title: "Łódź → Kärkinen", body: "Ääkköset ÅÄÖ åäö ja € toimivat, ✓ ei." }, [{ name: "Ł", address_lines: ["Łukasz", "Tie 1", "41800 KORPILAHTI"] }], {
      date: "25.9.2026",
      calibration: true,
    });
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
  });
});
