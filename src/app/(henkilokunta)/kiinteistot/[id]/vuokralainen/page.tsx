import { notFound } from "next/navigation";
import { Button, Field, Input, PageHeader, Panel, SectionTitle, Textarea } from "@/components/ui";
import { FormError } from "@/components/FormError";
import { requireRole } from "@/lib/auth/current-user";
import { formatDate, isoDateHelsinki } from "@/lib/format";
import { metersOn } from "@/lib/registry/changes";
import { TENANT_COMPONENT_LABEL, TENANT_COMPONENTS, type TenantComponent } from "@/lib/billing/parties";
import { changeTenantAction } from "../../changeActions";
import { PartyFields, ReadingFields } from "../ChangeFields";
import { loadChangeContext } from "../changeContext";

export const metadata = { title: "Vuokralaisen vaihdos" };

export default async function TenantChangePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ virhe?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireRole("owner", "staff");
  const today = isoDateHelsinki();
  const data = await ctx.run(async (tx) => {
    const c = await loadChangeContext(tx, ctx.org.organizationId, id, today);
    return c ? { ...c, meters: await metersOn(tx, id, today) } : null;
  });
  if (!data) notFound();
  const { property, owner, tenant, customers, meters } = data;

  return (
    <div className="max-w-3xl">
      <PageHeader title="Vuokralaisen vaihdos" subtitle={property.street_address} back={{ href: `/kiinteistot/${id}`, label: property.street_address }} />
      <FormError message={sp.virhe} />
      <form action={changeTenantAction} className="grid gap-8">
        <input type="hidden" name="propertyId" value={id} />
        <Panel>
          <SectionTitle>1. Vaihtopäivä</SectionTitle>
          <p className="mb-4 text-sm">
            Omistaja: <span className="font-semibold">{owner?.customer_name ?? "ei liittymissopimusta"}</span>
            {tenant ? (
              <>
                <br />
                Nykyinen vuokralainen: <span className="font-semibold">{tenant.customer_name}</span> ({formatDate(tenant.starts_on)} alkaen,{" "}
                {tenant.tenant_components.map((k) => TENANT_COMPONENT_LABEL[k as TenantComponent]?.toLowerCase() ?? k).join(", ")})
              </>
            ) : null}
          </p>
          <Field
            label="Vaihtopäivä"
            htmlFor="date"
            hint="Lähtevän vuokralaisen viimeinen päivä. Uuden käyttösopimus alkaa seuraavana päivänä. Kun vuokralaista ei ole, omistaja maksaa kaiken."
          >
            <Input id="date" name="date" type="date" defaultValue={today} required />
          </Field>
          {tenant ? (
            <label className="mt-4 flex items-center gap-2 text-sm">
              <input type="checkbox" name="endCurrent" defaultChecked className="size-4" /> Nykyinen vuokralainen muuttaa pois, käyttösopimus päättyy vaihtopäivään
            </label>
          ) : null}
        </Panel>

        <Panel>
          <SectionTitle>2. Uusi vuokralainen</SectionTitle>
          <PartyFields
            label="Uusi vuokralainen"
            customers={customers.filter((c) => c.id !== owner?.customer_id && c.id !== tenant?.customer_id)}
            optional="Ei uutta vuokralaista (vain poismuutto)"
          />
          <fieldset className="mt-4 text-sm">
            <legend className="mb-1 font-semibold">Käyttösopimus: vuokralainen maksaa</legend>
            <div className="flex flex-wrap gap-4">
              {TENANT_COMPONENTS.map((k) => (
                <label key={k} className="flex items-center gap-2">
                  <input type="checkbox" name="tenantComponents" value={k} defaultChecked={k === "usage"} className="size-4" /> {TENANT_COMPONENT_LABEL[k]}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-ink/55">Muut osat laskutetaan omistajalta. Lainaosuus ei koskaan siirry vuokralaiselle.</p>
          </fieldset>
        </Panel>

        <Panel>
          <SectionTitle>3. Lukema vaihtopäivältä</SectionTitle>
          <p className="mb-4 text-sm text-ink/70">Lukema on pakollinen: sillä kulutus jaetaan lähtevän ja tulevan maksajan kesken.</p>
          <ReadingFields meters={meters} />
        </Panel>

        <Panel>
          <Field label="Muistiinpano" htmlFor="notes">
            <Textarea id="notes" name="notes" rows={3} maxLength={2000} />
          </Field>
        </Panel>

        <div>
          <Button>Kirjaa vuokralaisen vaihdos</Button>
        </div>
      </form>
    </div>
  );
}
