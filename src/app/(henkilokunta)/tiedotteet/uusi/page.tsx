import { PageHeader, Panel } from "@/components/ui";
import { FormError } from "@/components/FormError";
import { requireRole } from "@/lib/auth/current-user";
import { listAreas } from "@/lib/registry/queries";
import { AnnouncementForm } from "../AnnouncementForm";
import { createAnnouncementAction } from "../actions";

export const metadata = { title: "Uusi tiedote" };

export default async function NewAnnouncementPage({ searchParams }: { searchParams: Promise<{ virhe?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireRole("owner", "staff");
  const areas = await ctx.run((tx) => listAreas(tx, ctx.org.organizationId));
  return (
    <>
      <PageHeader title="Uusi tiedote" back={{ href: "/tiedotteet", label: "Tiedotteet" }} />
      <FormError message={sp.virhe} />
      <Panel>
        <AnnouncementForm action={createAnnouncementAction} areas={areas} submitLabel="Tallenna luonnos" />
      </Panel>
    </>
  );
}
