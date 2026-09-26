import { NextResponse } from "next/server";
import { getCurrentUser, requireStaff } from "@/lib/auth/current-user";
import { changeFormUrl, qrPng, qrSvg } from "@/lib/change-requests/qr";

/** Muutosilmoituslomakkeen QR-koodi ladattavaksi laskupohjaan tai tiedotteeseen (?muoto=png|svg). */
export async function GET(request: Request) {
  if (!(await getCurrentUser())) return new NextResponse("Kirjaudu ensin", { status: 401 });
  const ctx = await requireStaff();
  if (!ctx.can("owner", "staff")) return new NextResponse("Kielletty", { status: 403 });
  const [org] = await ctx.run((tx) =>
    tx.query<{ change_form_token: string }>("select change_form_token from ml_organizations where id = $1", [ctx.org.organizationId]),
  );
  const url = await changeFormUrl(org.change_form_token);
  const png = new URL(request.url).searchParams.get("muoto") === "png";
  if (png) {
    return new NextResponse(new Uint8Array(await qrPng(url)), {
      headers: { "Content-Type": "image/png", "Content-Disposition": 'attachment; filename="muutosilmoitus-qr.png"', "Cache-Control": "no-store" },
    });
  }
  return new NextResponse(await qrSvg(url), {
    headers: { "Content-Type": "image/svg+xml", "Content-Disposition": 'attachment; filename="muutosilmoitus-qr.svg"', "Cache-Control": "no-store" },
  });
}
