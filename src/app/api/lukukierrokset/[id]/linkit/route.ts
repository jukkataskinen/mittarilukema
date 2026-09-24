import { NextResponse } from "next/server";
import { getCurrentUser, requireStaff } from "@/lib/auth/current-user";
import { createRoundLinks } from "@/lib/readings/links";
import { formatPhone } from "@/lib/validation/phone";

/**
 * Lukemalinkit CSV-tiedostona (puolipiste, UTF-8 BOM, aukeaa Excelissä).
 * POST, koska lataus luo uudet linkit ja korvaa kierroksen aiemmat.
 * Evästeet ovat SameSite=Lax, joten toiselta sivustolta lähetetty lomake ei
 * kulje kirjautuneena; lisäksi lähde tarkistetaan.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse("Ei löytynyt", { status: 404 });
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) return new NextResponse("Kielletty", { status: 403 });
  if (!(await getCurrentUser())) return new NextResponse("Kirjaudu ensin", { status: 401 });
  const ctx = await requireStaff();
  if (!ctx.can("owner", "staff")) return new NextResponse("Kielletty", { status: 403 });

  let links;
  try {
    links = await ctx.run((tx) => createRoundLinks(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, roundId: id }));
  } catch (err) {
    return new NextResponse(err instanceof Error ? err.message : "Virhe", { status: 400 });
  }
  const base = process.env.APP_BASE_URL?.replace(/\/$/, "") || new URL(request.url).origin;
  const esc = (v: string | null) => (v === null ? "" : /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const header = ["Asiakasnumero", "Asiakas", "Puhelin", "Osoite", "Unes", "Mittari", "Linkki"];
  const rows = links.map((l) => [
    l.customerNumber, l.customerName, l.phone ? formatPhone(l.phone) : null, [l.streetAddress, l.city].filter(Boolean).join(", "),
    l.legacyId, l.meterNumber, `${base}/lukema/${l.token}`,
  ]);
  const csv = "﻿" + [header, ...rows].map((r) => r.map(esc).join(";")).join("\r\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="lukemalinkit.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
