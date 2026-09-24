import { PageHeader, Panel } from "@/components/ui";
import { FormError } from "@/components/FormError";
import { requireRole } from "@/lib/auth/current-user";
import { CustomerForm } from "../CustomerForm";
import { createCustomerAction } from "../actions";

export const metadata = { title: "Uusi asiakas" };

export default async function NewCustomerPage({ searchParams }: { searchParams: Promise<{ virhe?: string }> }) {
  const sp = await searchParams;
  await requireRole("owner", "staff");
  return (
    <div className="max-w-2xl">
      <PageHeader title="Uusi asiakas" back={{ href: "/asiakkaat", label: "Asiakkaat" }} />
      <FormError message={sp.virhe} />
      <Panel>
        <CustomerForm action={createCustomerAction} submitLabel="Tallenna asiakas" />
      </Panel>
    </div>
  );
}
