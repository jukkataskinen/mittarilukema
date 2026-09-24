import { notFound } from "next/navigation";
import { PageHeader, Panel } from "@/components/ui";
import { FormError } from "@/components/FormError";
import { requireRole } from "@/lib/auth/current-user";
import { getProperty, listAreas } from "@/lib/registry/queries";
import { PropertyForm } from "../../PropertyForm";
import { updatePropertyAction } from "../../actions";

export const metadata = { title: "Muokkaa kiinteistöä" };

export default async function EditPropertyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ virhe?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireRole("owner", "staff");
  const data = await ctx.run(async (tx) => ({
    detail: await getProperty(tx, ctx.org.organizationId, id),
    areas: await listAreas(tx, ctx.org.organizationId),
    org: (await tx.query<{ billing_method: string }>("select billing_method from ml_organizations where id = $1", [ctx.org.organizationId]))[0],
  }));
  if (!data.detail) notFound();
  return (
    <div className="max-w-2xl">
      <PageHeader title="Muokkaa kiinteistöä" back={{ href: `/kiinteistot/${id}`, label: data.detail.property.street_address }} />
      <FormError message={sp.virhe} />
      <Panel>
        <PropertyForm
          action={updatePropertyAction}
          areas={data.areas}
          property={data.detail.property}
          orgBillingMethod={data.org.billing_method}
          submitLabel="Tallenna muutokset"
        />
      </Panel>
    </div>
  );
}
