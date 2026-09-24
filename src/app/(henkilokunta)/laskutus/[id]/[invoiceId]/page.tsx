import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, DefinitionList, Field, Input, Notice, PageHeader, Panel, SectionTitle, Table, Td, Th } from "@/components/ui";
import { FormError } from "@/components/FormError";
import { requireRole } from "@/lib/auth/current-user";
import { getInvoice } from "@/lib/billing/queries";
import { CONNECTION_KIND } from "@/lib/labels";
import { formatDate, formatEur, formatNumber } from "@/lib/format";
import { excludeInvoiceAction } from "../../actions";

export const metadata = { title: "Lasku" };

const priceFmt = new Intl.NumberFormat("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const UNIT = { m3: "m³", month: "kk", year: "v" } as const;

export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; invoiceId: string }>;
  searchParams: Promise<{ virhe?: string }>;
}) {
  const [{ id, invoiceId }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/.test(id) || !/^[0-9a-f-]{36}$/.test(invoiceId)) notFound();
  const ctx = await requireRole("owner", "staff");
  const data = await ctx.run((tx) => getInvoice(tx, ctx.org.organizationId, invoiceId));
  if (!data || data.invoice.run_id !== id) notFound();
  const { invoice: i, lines, meters } = data;
  const meterName = (mid: string) => {
    const m = meters.find((x) => x.id === mid);
    return m?.meter_number ?? "Numeroton mittari";
  };
  const draft = i.run_status === "draft";

  return (
    <>
      <PageHeader
        title={i.street_address}
        subtitle={`Lasku jaksolta ${formatDate(i.period_start)} – ${formatDate(i.period_end)}`}
        back={{ href: `/laskutus/${id}`, label: "Laskutusajo" }}
        actions={i.status === "excluded" ? <Badge>Jätetty pois</Badge> : null}
      />
      <FormError message={sp.virhe} />

      {i.issues.length ? (
        <div className="mb-6">
          <Notice tone="alert" title="Huomautukset">
            <ul className="list-disc pl-5">
              {i.issues.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </Notice>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <DefinitionList
            items={[
              {
                label: "Maksaja",
                value: i.customer_id ? (
                  <Link href={`/asiakkaat/${i.customer_id}`} className="font-semibold text-sky">
                    {i.customer_name}
                  </Link>
                ) : (
                  <Badge tone="alert">Puuttuu</Badge>
                ),
              },
              { label: "Asiakasnumero", value: i.customer_number },
              { label: "Laskutusosoite", value: [i.billing_street, [i.billing_postal_code, i.billing_city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null },
              {
                label: "Kiinteistö",
                value: (
                  <Link href={`/kiinteistot/${i.property_id}`} className="font-semibold text-sky">
                    {i.street_address}
                    {i.legacy_id ? ` (Unes ${i.legacy_id})` : ""}
                  </Link>
                ),
              },
            ]}
          />
        </Panel>
        <Panel>
          <DefinitionList
            items={[
              { label: "Vesi", value: formatNumber(i.water_m3, "m³") },
              { label: "Jätevesi", value: formatNumber(i.wastewater_m3, "m³") },
              { label: "Veroton", value: formatEur(i.net_eur) },
              { label: "Arvonlisävero", value: formatEur(i.vat_eur) },
              { label: "Yhteensä", value: <span className="text-lg font-bold">{formatEur(i.gross_eur)}</span> },
            ]}
          />
        </Panel>
      </div>

      <section className="mt-8">
        <SectionTitle>Laskurivit</SectionTitle>
        <Table>
          <thead>
            <tr>
              <Th>Tuote</Th>
              <Th numeric>Määrä</Th>
              <Th numeric>Hinta</Th>
              <Th numeric>Alv</Th>
              <Th numeric>Veroton</Th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.line_no}>
                <Td>{l.description}</Td>
                <Td numeric>
                  {formatNumber(l.quantity)} {UNIT[l.unit]}
                </Td>
                <Td numeric>{priceFmt.format(Number(l.unit_price))} €</Td>
                <Td numeric>{formatNumber(l.vat_percent)} %</Td>
                <Td numeric>{formatEur(l.net_eur)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>

      <section className="mt-8">
        <SectionTitle>Lisätieto laskulla</SectionTitle>
        <Panel>
          {i.info ? (
            <p className="whitespace-pre-line font-mono text-sm">{i.info}</p>
          ) : (
            <p className="text-sm text-ink/65">Lisätietoa ei muodostunut, koska kulutusta ei laskettu mittarilukemista.</p>
          )}
        </Panel>
      </section>

      <section className="mt-8">
        <SectionTitle>Kulutuksen peruste</SectionTitle>
        {i.usage.length === 0 ? (
          <p className="text-sm text-ink/65">Kulutusta ei laskettu mittareilta.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Mittari</Th>
                <Th>Liittymä</Th>
                <Th>Edellinen lukema</Th>
                <Th>Uusi lukema</Th>
                <Th numeric>Kulutus</Th>
              </tr>
            </thead>
            <tbody>
              {i.usage.map((u) => (
                <tr key={u.meterId}>
                  <Td className="tabular">{meterName(u.meterId)}</Td>
                  <Td>{CONNECTION_KIND[u.connectionKind]}</Td>
                  <Td className="tabular">{u.from ? `${formatNumber(u.from.reading)} (${formatDate(u.from.readOn)})` : "–"}</Td>
                  <Td className="tabular">{u.to ? `${formatNumber(u.to.reading)} (${formatDate(u.to.readOn)})` : "–"}</Td>
                  <Td numeric>{formatNumber(u.m3, "m³")}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      {draft ? (
        <section className="mt-8 max-w-xl">
          <SectionTitle>{i.status === "excluded" ? "Palauta ajoon" : "Jätä pois ajosta"}</SectionTitle>
          <Panel>
            <form action={excludeInvoiceAction} className="grid gap-4">
              <input type="hidden" name="invoiceId" value={i.id} />
              <input type="hidden" name="runId" value={id} />
              <input type="hidden" name="excluded" value={i.status === "excluded" ? "0" : "1"} />
              {i.status === "excluded" ? (
                <p className="text-sm text-ink/70">Syy: {i.excluded_reason ?? "–"}</p>
              ) : (
                <Field label="Syy" htmlFor="reason" hint="Esimerkiksi: loppulasku tehdään erikseen.">
                  <Input id="reason" name="reason" />
                </Field>
              )}
              <div>
                <Button variant="secondary">{i.status === "excluded" ? "Palauta ajoon" : "Jätä pois"}</Button>
              </div>
            </form>
          </Panel>
        </section>
      ) : null}
    </>
  );
}
