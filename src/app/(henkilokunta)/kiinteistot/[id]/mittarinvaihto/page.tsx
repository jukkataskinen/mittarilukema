import { notFound } from "next/navigation";
import { Button, Field, Input, Notice, PageHeader, Panel, Select, Textarea } from "@/components/ui";
import { FormError } from "@/components/FormError";
import { requireRole } from "@/lib/auth/current-user";
import { CONNECTION_KIND, READ_METHOD } from "@/lib/labels";
import { formatDate, formatNumber, isoDateHelsinki } from "@/lib/format";
import { swapMeterAction } from "../../changeActions";

export const metadata = { title: "Mittarinvaihto" };

export default async function MeterSwapPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ virhe?: string; mittari?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireRole("owner", "staff");
  const today = isoDateHelsinki();
  const data = await ctx.run(async (tx) => {
    const [property] = await tx.query<{ street_address: string }>("select street_address from ml_properties where organization_id = $1 and id = $2", [
      ctx.org.organizationId,
      id,
    ]);
    if (!property) return null;
    const meters = await tx.query<{ id: string; meter_number: string | null; kind: "water" | "wastewater"; read_method: string; last_reading: string | null; last_read_on: string | null }>(
      `select m.id, m.meter_number, k.kind, m.read_method, r.reading::text as last_reading, r.read_on::text as last_read_on
         from ml_meters m join ml_connections k on k.id = m.connection_id
         left join lateral (select reading, read_on from ml_readings where meter_id = m.id and status = 'accepted' order by read_on desc limit 1) r on true
        where k.property_id = $1 and m.removed_on is null order by k.kind, m.meter_number`,
      [id],
    );
    return { property, meters };
  });
  if (!data) notFound();
  const { property, meters } = data;
  const selected = meters.find((m) => m.id === sp.mittari) ?? meters[0];

  return (
    <div className="max-w-2xl">
      <PageHeader title="Mittarinvaihto" subtitle={property.street_address} back={{ href: `/kiinteistot/${id}`, label: property.street_address }} />
      <FormError message={sp.virhe} />
      {!selected ? (
        <Notice tone="warn" title="Käyttöpaikalla ei ole käytössä olevia mittareita" />
      ) : (
        <Panel>
          <form action={swapMeterAction} className="grid gap-5 sm:grid-cols-2">
            <input type="hidden" name="propertyId" value={id} />
            <div className="sm:col-span-2">
              <Field label="Vaihdettava mittari" htmlFor="oldMeterId">
                <Select id="oldMeterId" name="oldMeterId" defaultValue={selected.id}>
                  {meters.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.meter_number ?? "Numeroton mittari"} ({CONNECTION_KIND[m.kind].toLowerCase()}, {READ_METHOD[m.read_method]?.toLowerCase()})
                      {m.last_reading ? `, edellinen ${formatNumber(m.last_reading)} ${formatDate(m.last_read_on!)}` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Vaihtopäivä" htmlFor="date" hint="Vanha mittari poistuu ja uusi asennetaan tänä päivänä.">
              <Input id="date" name="date" type="date" defaultValue={today} max={today} required />
            </Field>
            <Field label="Vanhan mittarin loppulukema" htmlFor="finalReading" hint="Lukema irrotushetkellä. Laskutetaan vielä seuraavalla laskulla.">
              <Input id="finalReading" name="finalReading" inputMode="decimal" autoComplete="off" required />
            </Field>
            <Field label="Uuden mittarin numero" htmlFor="newMeterNumber">
              <Input id="newMeterNumber" name="newMeterNumber" autoComplete="off" required maxLength={60} />
            </Field>
            <Field label="Uuden mittarin aloituslukema" htmlFor="startReading" hint="Uuden mittarin lukema asennushetkellä, yleensä 0.">
              <Input id="startReading" name="startReading" inputMode="decimal" defaultValue="0" required />
            </Field>
            <Field label="Uuden mittarin lukutapa" htmlFor="readMethod">
              <Select id="readMethod" name="readMethod" defaultValue="remote">
                <option value="remote">{READ_METHOD.remote}</option>
                <option value="mechanical">{READ_METHOD.mechanical}</option>
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Muistiinpano" htmlFor="notes" hint="Esimerkiksi asentaja tai vaihdon syy.">
                <Textarea id="notes" name="notes" rows={2} maxLength={2000} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Button>Kirjaa mittarinvaihto</Button>
            </div>
          </form>
        </Panel>
      )}
    </div>
  );
}
