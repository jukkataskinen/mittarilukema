import { notFound, redirect } from "next/navigation";
import { PageHeader, Panel } from "@/components/ui";
import { FormError } from "@/components/FormError";
import { requireRole } from "@/lib/auth/current-user";
import { listAreas } from "@/lib/registry/queries";
import type { Audience, Delivery } from "@/lib/announcements";
import { AnnouncementForm } from "../../AnnouncementForm";
import { updateAnnouncementAction } from "../../actions";

export const metadata = { title: "Muokkaa tiedotetta" };

export default async function EditAnnouncementPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ virhe?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireRole("owner", "staff");
  const data = await ctx.run(async (tx) => {
    const [a] = await tx.query<{ id: string; title: string; body: string; audience: Audience; area_id: string | null; delivery: Delivery; status: string }>(
      "select id, title, body, audience, area_id, delivery, status from ml_announcements where id = $1 and organization_id = $2",
      [id, ctx.org.organizationId],
    );
    return a ? { a, areas: await listAreas(tx, ctx.org.organizationId) } : null;
  });
  if (!data) notFound();
  if (data.a.status !== "draft") redirect(`/tiedotteet/${id}`);
  return (
    <>
      <PageHeader title="Muokkaa tiedotetta" back={{ href: `/tiedotteet/${id}`, label: "Tiedote" }} />
      <FormError message={sp.virhe} />
      <Panel>
        <AnnouncementForm action={updateAnnouncementAction} areas={data.areas} announcement={data.a} submitLabel="Tallenna" />
      </Panel>
    </>
  );
}
