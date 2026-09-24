import { Badge, Button, EmptyState, Field, Input, Notice, PageHeader, Panel, SectionTitle, Select, Table, Td, Th } from "@/components/ui";
import { FormError } from "@/components/FormError";
import { requireRole } from "@/lib/auth/current-user";
import { listAreas, listTariffs } from "@/lib/registry/queries";
import { CHARGE_TYPE, CONNECTION_KIND, TARIFF_UNIT } from "@/lib/labels";
import { formatDate, isoDateHelsinki } from "@/lib/format";
import { createTariffAction, endTariffAction } from "./actions";

export const metadata = { title: "Hinnasto" };

const priceFmt = new Intl.NumberFormat("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const vatFmt = new Intl.NumberFormat("fi-FI", { maximumFractionDigits: 2 });

export default async function TariffsPage({ searchParams }: { searchParams: Promise<{ virhe?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireRole("owner", "staff");
  const orgId = ctx.org.organizationId;
  const { tariffs, areas } = await ctx.run(async (tx) => ({ tariffs: await listTariffs(tx, orgId), areas: await listAreas(tx, orgId) }));
  const today = isoDateHelsinki();

  return (
    <>
      <PageHeader title="Hinnasto" subtitle="Hinnat ilman arvonlisäveroa. Hinnanmuutos tehdään päättämällä vanha hinta ja lisäämällä uusi." />
      <FormError message={sp.virhe} />

      {tariffs.length === 0 ? (
        <EmptyState title="Hinnasto on tyhjä">Lisää perusmaksut ja käyttömaksut alla.</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Maksu</Th>
              <Th>Laji</Th>
              <Th>Alue</Th>
              <Th numeric>Hinta</Th>
              <Th numeric>Alv</Th>
              <Th>Voimassa</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {tariffs.map((t) => {
              const ended = t.valid_to !== null && t.valid_to < today;
              const upcoming = t.valid_from > today;
              return (
                <tr key={t.id} className={ended ? "text-ink/45" : undefined}>
                  <Td>
                    <span className="font-semibold">{t.name}</span>
                    <span className="block text-xs text-ink/55">{CHARGE_TYPE[t.charge_type]}</span>
                  </Td>
                  <Td>{t.connection_kind ? CONNECTION_KIND[t.connection_kind] : "–"}</Td>
                  <Td>{t.area_name ?? "Kaikki"}</Td>
                  <Td numeric className="whitespace-nowrap">
                    {priceFmt.format(Number(t.price_eur))} {TARIFF_UNIT[t.unit]}
                  </Td>
                  <Td numeric>{vatFmt.format(Number(t.vat_percent))} %</Td>
                  <Td className="tabular whitespace-nowrap">
                    {formatDate(t.valid_from)} – {t.valid_to ? formatDate(t.valid_to) : ""}
                    {upcoming ? (
                      <span className="ml-2">
                        <Badge tone="info">Tuleva</Badge>
                      </span>
                    ) : null}
                  </Td>
                  <Td className="text-right">
                    {!t.valid_to ? (
                      <form action={endTariffAction} className="inline-flex items-center gap-2">
                        <input type="hidden" name="tariffId" value={t.id} />
                        <label htmlFor={`end-${t.id}`} className="sr-only">
                          Viimeinen voimassaolopäivä
                        </label>
                        <input id={`end-${t.id}`} name="validTo" type="date" required className="rounded-lg border border-line px-2 py-1 text-sm" />
                        <button className="text-sm font-semibold text-sky">Päätä</button>
                      </form>
                    ) : null}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}

      <section className="mt-10 max-w-3xl">
        <SectionTitle>Uusi hinta</SectionTitle>
        <Panel>
          <form action={createTariffAction} className="grid gap-4 sm:grid-cols-2">
            <Field label="Maksulaji" htmlFor="chargeType">
              <Select id="chargeType" name="chargeType" defaultValue="usage_fee">
                {Object.entries(CHARGE_TYPE).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Nimi laskulla" htmlFor="name">
              <Input id="name" name="name" placeholder="Käyttömaksu, vesi" required />
            </Field>
            <Field label="Liittymä" htmlFor="connectionKind">
              <Select id="connectionKind" name="connectionKind" defaultValue="water">
                <option value="water">{CONNECTION_KIND.water}</option>
                <option value="wastewater">{CONNECTION_KIND.wastewater}</option>
                <option value="">Ei liittymäkohtainen</option>
              </Select>
            </Field>
            <Field label="Alue" htmlFor="areaId">
              <Select id="areaId" name="areaId" defaultValue="">
                <option value="">Kaikki alueet</option>
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Hinta (€, alv 0 %)" htmlFor="price">
              <Input id="price" name="price" inputMode="decimal" required />
            </Field>
            <Field label="Yksikkö" htmlFor="unit">
              <Select id="unit" name="unit" defaultValue="m3">
                {Object.entries(TARIFF_UNIT).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Arvonlisävero (%)" htmlFor="vatPercent">
              <Input id="vatPercent" name="vatPercent" inputMode="decimal" defaultValue="25,5" required />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Alkaa" htmlFor="validFrom">
                <Input id="validFrom" name="validFrom" type="date" defaultValue={today} required />
              </Field>
              <Field label="Päättyy" htmlFor="validTo">
                <Input id="validTo" name="validTo" type="date" />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Button>Tallenna hinta</Button>
            </div>
          </form>
        </Panel>
        <div className="mt-4">
          <Notice tone="info" title="Kärkisten lainaosuus">
            Lainaosuuden laskentatapa on vielä selvittämättä. Sen voi kirjata alustavasti kiinteänä maksuna.
          </Notice>
        </div>
      </section>
    </>
  );
}
