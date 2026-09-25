import { NextResponse } from "next/server";
import { getCurrentUser, requireStaff } from "@/lib/auth/current-user";
import { formatDate, isoDateHelsinki } from "@/lib/format";
import { buildLettersPdf, type Letter } from "@/lib/announcements/letter";
import type { OrgContact } from "@/lib/announcements";

/**
 * Tiedotteen kirjeet PDF:nä ikkunakuoriin. Oletuksena tulostamattomat
 * (pending) kirjeet, ?kaikki=1 kaikki kirjeet uudelleen. ?koe=1 tuottaa yhden
 * esimerkkikirjeen, jossa ikkunan paikka on merkitty. Lataus ei muuta mitään:
 * postitetuiksi merkitään erikseen tulostuksen jälkeen.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse("Ei löytynyt", { status: 404 });
  if (!(await getCurrentUser())) return new NextResponse("Kirjaudu ensin", { status: 401 });
  const ctx = await requireStaff();
  if (!ctx.can("owner", "staff")) return new NextResponse("Kielletty", { status: 403 });
  const url = new URL(request.url);
  const calibration = url.searchParams.get("koe") === "1";
  const all = url.searchParams.get("kaikki") === "1";

  const data = await ctx.run(async (tx) => {
    const [a] = await tx.query<{ title: string; body: string } & OrgContact>(
      `select a.title, a.body, o.name, o.contact_email, o.contact_phone, o.postal_street, o.postal_code, o.postal_city
         from ml_announcements a join ml_organizations o on o.id = a.organization_id where a.id = $1 and a.organization_id = $2`,
      [id, ctx.org.organizationId],
    );
    if (!a) return null;
    const letters = calibration
      ? []
      : await tx.query<Letter>(
          `select name, address_lines from ml_announcement_recipients
            where announcement_id = $1 and channel = 'letter' and ($2 or status = 'pending') order by name`,
          [id, all],
        );
    return { a, letters };
  });
  if (!data) return new NextResponse("Ei löytynyt", { status: 404 });
  // Koetulosteessa kuvitteellinen vastaanottaja, jottei henkilötietoja tulosteta turhaan.
  const letters: Letter[] = calibration
    ? [{ name: "Vastaanottajan Nimi", address_lines: ["Vastaanottajan Nimi", "Esimerkkitie 1 A 2", "41800 KORPILAHTI"] }]
    : data.letters;
  if (!letters.length) return new NextResponse("Ei tulostettavia kirjeitä", { status: 404 });

  const { pdf } = await buildLettersPdf(data.a, data.a, letters, { date: formatDate(isoDateHelsinki()), calibration });
  const name = calibration ? "koetuloste" : "tiedote-kirjeet";
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${name}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
