import { notFound } from "next/navigation";
import { Button, Field, Input, Notice, PageHeader, Panel, SectionTitle, Textarea } from "@/components/ui";
import { FormError } from "@/components/FormError";
import { requireRole } from "@/lib/auth/current-user";
import { formatDate, formatEur, isoDateHelsinki } from "@/lib/format";
import { metersOn } from "@/lib/registry/changes";
import { changeOwnerAction } from "../../changeActions";
import { PartyFields, ReadingFields } from "../ChangeFields";
import { loadChangeContext } from "../changeContext";

export const metadata = { title: "Omistajanvaihdos" };

export default async function OwnershipChangePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ virhe?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireRole("owner", "staff");
  const today = isoDateHelsinki();
  const data = await ctx.run(async (tx) => {
    const c = await loadChangeContext(tx, ctx.org.organizationId, id, today);
    return c ? { ...c, meters: await metersOn(tx, id, today) } : null;
  });
  if (!data) notFound();
  const { property, owner, tenant, loans, customers, meters } = data;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Omistajanvaihdos"
        subtitle={property.street_address}
        back={{ href: `/kiinteistot/${id}`, label: property.street_address }}
      />
      <FormError message={sp.virhe} />
      {!owner ? (
        <Notice tone="warn" title="Käyttöpaikalla ei ole voimassa olevaa liittymissopimusta">
          Kirjaa nykyinen omistaja ensin sopimuksena kiinteistön sivulla. Omistajanvaihdos päättää hänen sopimuksensa.
        </Notice>
      ) : (
        <form action={changeOwnerAction} className="grid gap-8">
          <input type="hidden" name="propertyId" value={id} />
          <Panel>
            <SectionTitle>1. Myyjä ja vaihtopäivä</SectionTitle>
            <p className="mb-4 text-sm">
              Nykyinen omistaja: <span className="font-semibold">{owner.customer_name}</span> ({formatDate(owner.starts_on)} alkaen)
            </p>
            <Field
              label="Vaihtopäivä"
              htmlFor="date"
              hint="Myyjän viimeinen päivä. Lukema kirjataan tälle päivälle, ja ostajan liittymissopimus alkaa seuraavana päivänä. Kuukausimaksut vaihtuvat vaihtoa seuraavan kuun alusta."
            >
              <Input id="date" name="date" type="date" defaultValue={today} required />
            </Field>
          </Panel>

          <Panel>
            <SectionTitle>2. Ostaja</SectionTitle>
            <PartyFields label="Uusi omistaja" customers={customers.filter((c) => c.id !== owner.customer_id)} />
          </Panel>

          <Panel>
            <SectionTitle>3. Lukema vaihtopäivältä</SectionTitle>
            <p className="mb-4 text-sm text-ink/70">
              Lukema on pakollinen: sillä kulutus jaetaan myyjän loppulaskulle ja ostajan ensimmäiselle laskulle. Mittarit ovat tämän päivän tilanteen mukaan.
            </p>
            <ReadingFields meters={meters} />
          </Panel>

          {loans.length ? (
            <Panel>
              <SectionTitle>4. Lainaosuus</SectionTitle>
              <p className="mb-3 text-sm">
                Käyttöpaikalla on lainaa jäljellä {formatEur(loans.reduce((s, l) => s + Number(l.balance_eur), 0))} ({formatDate(loans[0].balance_date)}).
                Laina peritään myyjältä, kunnes kauppakirja osoittaa sen siirtyneen ostajalle.
              </p>
              <div className="grid gap-2 text-sm">
                <label className="flex items-start gap-2">
                  <input type="radio" name="loanDecision" value="stays_with_seller" defaultChecked className="mt-1 size-4" />
                  <span>
                    <span className="font-semibold">Laina jää myyjälle</span>
                    <span className="block text-ink/60">Kauppakirjaa ei ole nähty tai laina ei siirry. Myyjä saa lainaosuudesta oman laskun.</span>
                  </span>
                </label>
                <label className="flex items-start gap-2">
                  <input type="radio" name="loanDecision" value="transfers" className="mt-1 size-4" />
                  <span>
                    <span className="font-semibold">Laina siirtyy ostajalle</span>
                    <span className="block text-ink/60">Kauppakirja osoittaa, että ostaja on ottanut lainan vastatakseen.</span>
                  </span>
                </label>
              </div>
            </Panel>
          ) : null}

          {tenant ? (
            <Panel>
              <SectionTitle>{loans.length ? "5." : "4."} Vuokralainen</SectionTitle>
              <p className="mb-3 text-sm">
                Käyttöpaikalla on käyttösopimus: <span className="font-semibold">{tenant.customer_name}</span>.
              </p>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="endTenant" className="size-4" /> Päätä käyttösopimus samana päivänä
              </label>
            </Panel>
          ) : null}

          <Panel>
            <Field label="Muistiinpano" htmlFor="notes" hint="Esimerkiksi kauppakirjan päiväys tai yhteyshenkilö.">
              <Textarea id="notes" name="notes" rows={3} maxLength={2000} />
            </Field>
          </Panel>

          <div>
            <Button>Kirjaa omistajanvaihdos</Button>
            <p className="mt-2 text-xs text-ink/55">
              Myyjän loppulasku ja ostajan ensimmäinen lasku syntyvät seuraavassa laskutusajossa. Kaikki vaiheet tallentuvat yhdessä, tai ei mitään.
            </p>
          </div>
        </form>
      )}
    </div>
  );
}
