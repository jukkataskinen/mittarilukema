import { notFound } from "next/navigation";
import { PageHeader, Panel } from "@/components/ui";
import { FormError } from "@/components/FormError";
import { requireRole } from "@/lib/auth/current-user";
import { getCustomer } from "@/lib/registry/queries";
import { CustomerForm } from "../../CustomerForm";
import { updateCustomerAction } from "../../actions";

export const metadata = { title: "Muokkaa asiakasta" };

export default async function EditCustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ virhe?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireRole("owner", "staff");
  const data = await ctx.run((tx) => getCustomer(tx, ctx.org.organizationId, id));
  if (!data) notFound();
  return (
    <div className="max-w-2xl">
      <PageHeader title="Muokkaa asiakasta" back={{ href: `/asiakkaat/${id}`, label: data.customer.name }} />
      <FormError message={sp.virhe} />
      <Panel>
        <CustomerForm action={updateCustomerAction} customer={data.customer} submitLabel="Tallenna muutokset" />
      </Panel>
    </div>
  );
}
