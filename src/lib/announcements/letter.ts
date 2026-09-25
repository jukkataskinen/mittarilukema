import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { signature, type OrgContact } from "./index";

/**
 * Tiedote ikkunakirjeeksi (A4). Vastaanottajan osoite on SFS 2487:n
 * osoitekentässä: 20 mm vasemmasta reunasta ja rivin 8 kohdalla (noin 45 mm
 * ylhäältä), joten se näkyy sekä kerran taitetun (C5) että kolmeen osaan
 * taitetun (E65) arkin ikkunakuoren ikkunasta. Koetulosteessa ikkunan
 * ohjeellinen paikka piirretään katkoviivalla, jotta asettelun voi
 * tarkistaa oikeaa kirjekuorta vasten ennen koko erän tulostusta.
 */

const MM = 72 / 25.4;
const PAGE_W = 210 * MM;
const PAGE_H = 297 * MM;
const LEFT = 20 * MM;
const RIGHT = 190 * MM;
const BOTTOM = 22 * MM;
// Pdf-lib mittaa y-koordinaatin alareunasta.
const fromTop = (mm: number) => PAGE_H - mm * MM;

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
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(announcement.title);
  doc.setCreator("Mittarilukema");
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.12, 0.16, 0.22);
  const muted = rgb(0.35, 0.39, 0.45);
  const sender = signature(org);

  for (const letter of letters) {
    const pages: PDFPage[] = [];
    const newPage = () => {
      const p = doc.addPage([PAGE_W, PAGE_H]);
      pages.push(p);
      return p;
    };
    let page = newPage();

    // Lähettäjä ja päiväys (ikkunan yläpuolella, eivät näy kuoresta).
    page.drawText(safe(bold, org.name), { x: LEFT, y: fromTop(15), size: 10, font: bold, color: ink });
    sender.slice(1).forEach((l, i) => page.drawText(safe(regular, l), { x: LEFT, y: fromTop(20 + i * 4.5), size: 8.5, font: regular, color: muted }));
    page.drawText(safe(regular, opts.date), { x: 125 * MM, y: fromTop(15), size: 10, font: regular, color: ink });

    // Vastaanottaja osoitekenttään.
    letter.address_lines.slice(0, 6).forEach((l, i) => {
      page.drawText(safe(regular, l), { x: LEFT + 2 * MM, y: fromTop(47 + i * 5), size: 11, font: regular, color: ink });
    });
    if (opts.calibration) {
      page.drawRectangle({
        x: LEFT, y: fromTop(85), width: 90 * MM, height: 45 * MM, borderColor: rgb(0.2, 0.45, 0.8), borderWidth: 0.8, borderDashArray: [4, 3],
      });
      page.drawText("Ikkunan ohjeellinen paikka (90 x 45 mm, 20 mm vasemmalta, 40 mm ylhäältä). Tarkista kirjekuorta vasten.", {
        x: LEFT, y: fromTop(89), size: 7, font: regular, color: rgb(0.2, 0.45, 0.8),
      });
      page.drawLine({ start: { x: 0, y: fromTop(99) }, end: { x: 8 * MM, y: fromTop(99) }, thickness: 0.6, color: muted });
      page.drawLine({ start: { x: 0, y: fromTop(148.5) }, end: { x: 8 * MM, y: fromTop(148.5) }, thickness: 0.6, color: muted });
    }

    // Otsikko ja teksti.
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
  }
  return doc.save();
}
