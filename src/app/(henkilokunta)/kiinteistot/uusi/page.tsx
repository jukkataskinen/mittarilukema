import { PageHeader, Panel } from "@/components/ui";
import { FormError } from "@/components/FormError";
import { requireRole } from "@/lib/auth/current-user";
import { listAreas } from "@/lib/registry/queries";
import { PropertyForm } from "../PropertyForm";
import { createPropertyAction } from "../actions";

export const metadata = { title: "Uusi kiinteistö" };

export default async function NewPropertyPage({ searchParams }: { searchParams: Promise<{ virhe?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireRole("owner", "staff");
  const { areas, org } = await ctx.run(async (tx) => ({
    areas: await listAreas(tx, ctx.org.organizationId),
    org: (await tx.query<{ billing_method: string }>("select billing_method from ml_organizations where id = $1", [ctx.org.organizationId]))[0],
  }));
  return (
    <div className="max-w-2xl">
      <PageHeader title="Uusi kiinteistö" back={{ href: "/kiinteistot", label: "Kiinteistöt" }} />
      <FormError message={sp.virhe} />
      <Panel>
        <PropertyForm action={createPropertyAction} areas={areas} orgBillingMethod={org.billing_method} submitLabel="Tallenna kiinteistö" />
      </Panel>
    </div>
  );
}
