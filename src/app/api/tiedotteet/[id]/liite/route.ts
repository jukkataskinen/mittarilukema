import { NextResponse } from "next/server";
import { getCurrentUser, requireStaff } from "@/lib/auth/current-user";
import { getAttachment } from "@/lib/announcements/attachment";

/** Tiedotteen PDF-liite. Organisaation rajaus RLS:llä; tiedostonimi otsakkeessa suojattuna. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse("Ei löytynyt", { status: 404 });
  if (!(await getCurrentUser())) return new NextResponse("Kirjaudu ensin", { status: 401 });
  const ctx = await requireStaff();
  if (!ctx.can("owner", "staff")) return new NextResponse("Kielletty", { status: 403 });
  const att = await ctx.run((tx) => getAttachment(tx, ctx.org.organizationId, id));
  if (!att) return new NextResponse("Ei liitettä", { status: 404 });
  const ascii = att.filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return new NextResponse(Buffer.from(att.data), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(att.filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
