import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { signature, type OrgContact } from "./index";

/**
 * Tiedote ikkunakirjeeksi (A4, isoikkunainen C5-kuori). Asettelu Postitan
 * kirjepohjaohjeen mukaan (postita.fi/static/postita/postitafi-kirjepohjaohje.pdf),
 * joka on myös SFS 2487:n osoitekenttä:
 *   lähettäjä        10–30 mm ylhäältä, 20–85 mm vasemmalta
 *   maksumerkintä    30–40 mm ylhäältä, jätetään tyhjäksi (Postita tulostaa Postin merkinnän)
 *   vastaanottaja    40–60 mm ylhäältä, 20–85 mm vasemmalta
 *   turva-alue       0–85 mm ylhäältä ja 0–110 mm vasemmalta: ei muuta sisältöä
 * Liian pitkä rivi pienennetään mahtumaan, jottei se näy ikkunasta väärin.
 * Koetulosteessa alueet piirretään katkoviivalla.
 */

const MM = 72 / 25.4;
const PAGE_W = 210 * MM;
const PAGE_H = 297 * MM;
const LEFT = 20 * MM;
const RIGHT = 190 * MM;
const BOTTOM = 22 * MM;
// Pdf-lib mittaa y-koordinaatin alareunasta.
const fromTop = (mm: number) => PAGE_H - mm * MM;
// Osoitekenttien leveys (20–85 mm).
const FIELD_W = 65 * MM;

/** Rivi mahtumaan kenttään: fonttia pienennetään enintään 7 pisteeseen, sitten rivi lyhennetään. */
function fit(font: PDFFont, text: string, size: number, width = FIELD_W): { text: string; size: number } {
  let s = size;
  while (s > 7 && font.widthOfTextAtSize(text, s) > width) s -= 0.5;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(t, s) > width) t = t.slice(0, -1);
  return { text: t, size: s };
}

export interface Letter {
  name: string;
  address_lines: string[];
}

/** Vakiofontti (WinAnsi) ei sisällä kaikkia merkkejä; tuntematon merkki korvataan kysymysmerkillä. */
function safe(font: PDFFont, text: string): string {
  let out = "";
  for (const ch of text.normalize("NFC")) {
    // Rivinvaihto säilyy (kappaleet), vaikka fontti ei osaa sitä piirtää.
    if (ch === "\n") {
      out += ch;
      continue;
    }
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += "?";
    }
  }
  return out;
}

function wrap(font: PDFFont, size: number, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) line = next;
      else {
        if (line) lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

export async function buildLettersPdf(
  org: OrgContact,
  announcement: { title: string; body: string },
  letters: Letter[],
  opts: { date: string; calibration?: boolean },
): Promise<{ pdf: Uint8Array; pagesPerLetter: number }> {
  const doc = await PDFDocument.create();
  doc.setTitle(announcement.title);
  doc.setCreator("Mittarilukema");
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.12, 0.16, 0.22);
  const muted = rgb(0.35, 0.39, 0.45);
  const sender = signature(org);
  const pageCounts = new Set<number>();

  for (const letter of letters) {
    const pages: PDFPage[] = [];
    const newPage = () => {
      const p = doc.addPage([PAGE_W, PAGE_H]);
      pages.push(p);
      return p;
    };
    let page = newPage();

    // Lähettäjä 10–30 mm (näkyy ikkunasta palautusosoitteena). Päiväys turva-alueen oikealla puolella.
    const senderLines = [{ font: bold, text: org.name, size: 9.5 }, ...sender.slice(1).map((t) => ({ font: regular, text: t, size: 8 }))].slice(0, 4);
    senderLines.forEach((l, i) => {
      const f = fit(l.font, safe(l.font, l.text), l.size);
      page.drawText(f.text, { x: LEFT, y: fromTop(14 + i * 4.4), size: f.size, font: l.font, color: i ? muted : ink });
    });
    page.drawText(safe(regular, opts.date), { x: 125 * MM, y: fromTop(15), size: 10, font: regular, color: ink });

    // Vastaanottaja 40–60 mm: enintään neljä riviä. 30–40 mm jää tyhjäksi maksumerkinnälle.
    letter.address_lines.slice(0, 4).forEach((l, i) => {
      const f = fit(regular, safe(regular, l), 10.5);
      page.drawText(f.text, { x: LEFT, y: fromTop(45 + i * 4.6), size: f.size, font: regular, color: ink });
    });
    if (opts.calibration) {
      const blue = rgb(0.2, 0.45, 0.8);
      const box = (top: number, bottom: number, left: number, right: number, dash: number[]) =>
        page.drawRectangle({ x: left * MM, y: fromTop(bottom), width: (right - left) * MM, height: (bottom - top) * MM, borderColor: blue, borderWidth: 0.7, borderDashArray: dash });
      box(10, 30, 20, 85, [4, 3]);
      box(40, 60, 20, 85, [4, 3]);
      box(0.5, 85, 0.5, 110, [1, 2]);
      page.drawText("Maksumerkintä (30-40 mm), jätä tyhjäksi", { x: LEFT, y: fromTop(36), size: 7, font: regular, color: blue });
      page.drawText("Lähettäjä 10-30 mm ja vastaanottaja 40-60 mm ylhäältä, 20-85 mm vasemmalta. Pisteviiva: turva-alue.", {
        x: LEFT, y: fromTop(90), size: 7, font: regular, color: blue,
      });
    }

    // Otsikko ja teksti turva-alueen alapuolelle.
    let y = fromTop(105);
    for (const l of wrap(bold, 13, safe(bold, announcement.title), RIGHT - LEFT)) {
      page.drawText(l, { x: LEFT, y, size: 13, font: bold, color: ink });
      y -= 6.5 * MM;
    }
    y -= 2 * MM;
    const lineH = 5.2 * MM;
    const body = [...wrap(regular, 11, safe(regular, announcement.body.trim().replace(/\r/g, "")), RIGHT - LEFT), "", ...sender.map((s) => safe(regular, s))];
    for (const l of body) {
      if (y < BOTTOM) {
        page = newPage();
        y = fromTop(25);
      }
      if (l) page.drawText(l, { x: LEFT, y, size: 11, font: regular, color: ink });
      y -= lineH;
    }
    // Sivunumerot kirjeen sisällä, jotta monisivuiset kirjeet eivät sekoitu.
    if (pages.length > 1) {
      pages.forEach((p, i) => p.drawText(`${i + 1} (${pages.length})`, { x: 180 * MM, y: fromTop(15), size: 9, font: regular, color: muted }));
    }
    pageCounts.add(pages.length);
  }
  // Postita jakaa PDF:n kirjeiksi sivumäärän mukaan (pdf_splitter), joten kirjeiden on oltava yhtä pitkiä.
  if (pageCounts.size > 1) throw new Error("Kirjeiden sivumäärät poikkeavat toisistaan.");
  return { pdf: await doc.save(), pagesPerLetter: [...pageCounts][0] ?? 0 };
}
