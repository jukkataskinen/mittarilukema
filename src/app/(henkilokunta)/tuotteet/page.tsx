import Link from "next/link";
import { Badge, Button, EmptyState, Field, Input, LinkButton, Notice, PageHeader, Panel, SectionTitle, Table, Td, Th } from "@/components/ui";
import { FormError } from "@/components/FormError";
import { requireRole } from "@/lib/auth/current-user";
import { formatNumber } from "@/lib/format";
import { MATCH_LABEL } from "@/lib/products";
import { saveAccountAction, saveCostCenterAction, saveFennoaDimAction } from "./actions";

export const metadata = { title: "Tuotteet ja tilit" };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ virhe?: string; tallennettu?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireRole("owner", "staff");
  const orgId = ctx.org.organizationId;
  const data = await ctx.run(async (tx) => ({
    products: await tx.query<{
      id: string; code: string; name: string; unit: string | null; default_price_eur: string | null; vat_percent: string | null; account: string | null;
      cost_center: string | null; active: boolean; auto_match: boolean; match_charge_type: string | null; match_connection_kind: string | null;
      match_fee_class: string | null; area: string | null; match_customer_group: string | null; match_metered: boolean | null;
    }>(
      `select p.id, p.code, p.name, p.unit, p.default_price_eur::text, p.vat_percent::text, a.code as account, c.code || ' ' || c.name as cost_center, p.active,
              p.auto_match, p.match_charge_type, p.match_connection_kind, p.match_fee_class, ar.name as area, p.match_customer_group, p.match_metered
         from ml_products p left join ml_accounts a on a.id = p.account_id left join ml_cost_centers c on c.id = p.cost_center_id
         left join ml_areas ar on ar.id = p.match_area_id
        where p.organization_id = $1 order by p.active desc, p.code`,
      [orgId],
    ),
    accounts: await tx.query<{ id: string; code: string; name: string | null; products: number }>(
      `select a.id, a.code, a.name, (select count(*)::int from ml_products p where p.account_id = a.id) as products
         from ml_accounts a where a.organization_id = $1 order by a.code`,
      [orgId],
    ),
    costCenters: await tx.query<{ id: string; code: string; name: string; description: string | null; active: boolean; products: number }>(
      `select c.id, c.code, c.name, c.description, c.active, (select count(*)::int from ml_products p where p.cost_center_id = c.id) as products
         from ml_cost_centers c where c.organization_id = $1 order by c.code`,
      [orgId],
    ),
    org: (await tx.query<{ fennoa_cost_center_dim: string | null }>("select fennoa_cost_center_dim from ml_organizations where id = $1", [orgId]))[0],
  }));
  const rule = (p: (typeof data.products)[number]) =>
    [
      p.match_charge_type ? MATCH_LABEL.chargeType[p.match_charge_type] : null,
      p.match_connection_kind ? MATCH_LABEL.connectionKind[p.match_connection_kind].toLowerCase() : null,
      p.match_fee_class ? p.match_fee_class.toUpperCase() : null,
      p.area,
      p.match_customer_group ? `ryhmä ${p.match_customer_group}` : null,
      p.match_metered === false ? "ei mittaria" : p.match_metered ? "mittari" : null,
    ]
      .filter(Boolean)
      .join(", ");

  return (
    <>
      <PageHeader
        title="Tuotteet ja tilit"
        subtitle="Laskurivit viedään Fennoaan tuotekoodilla, kirjanpitotilillä ja laskentakohteella."
        actions={<LinkButton href="/tuotteet/uusi">Uusi tuote</LinkButton>}
      />
      <FormError message={sp.virhe} />
      {sp.tallennettu ? (
        <div className="mb-5">
          <Notice tone="ok" title={`Tuote ${sp.tallennettu} tallennettu.`}>
            Muutos koskee uusia laskutusajoja. Jo lasketut laskut pitävät tuotteen, joka niille valittiin.
          </Notice>
        </div>
      ) : null}

      <section>
        <SectionTitle>Tuotteet</SectionTitle>
        {data.products.length === 0 ? (
          <EmptyState title="Ei tuotteita">Tuotteet tuodaan Fennoan tuotelistasta tai lisätään käsin.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Koodi</Th>
                <Th>Tuote</Th>
                <Th>Tili</Th>
                <Th>Laskentakohde</Th>
                <Th>Valitaan laskulle</Th>
              </tr>
            </thead>
            <tbody>
              {data.products.map((p) => (
                <tr key={p.id} id={p.id} className={p.active ? undefined : "text-ink/45"}>
                  <Td className="tabular">
                    <Link href={`/tuotteet/${p.id}`} className="font-semibold hover:text-sky">
                      {p.code}
                    </Link>
                  </Td>
                  <Td>
                    {p.name}
                    <span className="block text-xs text-ink/55">
                      {p.default_price_eur ? `${formatNumber(p.default_price_eur)} €${p.unit ? `/${p.unit}` : ""}` : ""}
                      {p.vat_percent ? `, alv ${formatNumber(p.vat_percent)} %` : ", ei alv"}
                      {!p.active ? ", ei käytössä" : ""}
                    </span>
                  </Td>
                  <Td className="tabular">{p.account ?? <span className="text-coral">puuttuu</span>}</Td>
                  <Td>{p.cost_center ?? "–"}</Td>
                  <Td>{p.auto_match ? <span className="text-sm">{rule(p)}</span> : <Badge>Käsin</Badge>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        <section id="laskentakohteet">
          <SectionTitle>Laskentakohteet</SectionTitle>
          <Table>
            <thead>
              <tr>
                <Th>Koodi</Th>
                <Th>Nimi</Th>
                <Th numeric>Tuotteita</Th>
              </tr>
            </thead>
            <tbody>
              {data.costCenters.map((c) => (
                <tr key={c.id} className={c.active ? undefined : "text-ink/45"}>
                  <Td className="tabular">{c.code}</Td>
                  <Td>
                    {c.name}
                    {c.description ? <span className="block text-xs text-ink/55">{c.description}</span> : null}
                    {!c.active ? <span className="block text-xs">ei käytössä</span> : null}
                  </Td>
                  <Td numeric>{c.products}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Panel className="mt-4">
            <form action={saveCostCenterAction} className="grid gap-3 sm:grid-cols-[6rem_1fr]">
              <Field label="Koodi" htmlFor="cc-code">
                <Input id="cc-code" name="code" required maxLength={20} />
              </Field>
              <Field label="Nimi" htmlFor="cc-name">
                <Input id="cc-name" name="name" required maxLength={200} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Selite" htmlFor="cc-desc">
                  <Input id="cc-desc" name="description" maxLength={500} />
                </Field>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="active" defaultChecked className="size-4" /> Käytössä
              </label>
              <div>
                <Button variant="secondary">Tallenna laskentakohde</Button>
              </div>
            </form>
            <p className="mt-2 text-xs text-ink/55">Sama koodi päivittää olemassa olevan laskentakohteen.</p>
          </Panel>
        </section>

        <section id="tilit">
          <SectionTitle>Kirjanpidon tilit</SectionTitle>
          <Table>
            <thead>
              <tr>
                <Th>Tili</Th>
                <Th>Nimi</Th>
                <Th numeric>Tuotteita</Th>
              </tr>
            </thead>
            <tbody>
              {data.accounts.map((a) => (
                <tr key={a.id}>
                  <Td className="tabular">{a.code}</Td>
                  <Td>{a.name ?? <span className="text-ink/45">ei nimeä</span>}</Td>
                  <Td numeric>{a.products}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Panel className="mt-4">
            <form action={saveAccountAction} className="grid gap-3 sm:grid-cols-[8rem_1fr]">
              <Field label="Tili" htmlFor="acc-code">
                <Input id="acc-code" name="code" required maxLength={20} inputMode="numeric" />
              </Field>
              <Field label="Nimi" htmlFor="acc-name">
                <Input id="acc-name" name="name" maxLength={200} />
              </Field>
              <div>
                <Button variant="secondary">Tallenna tili</Button>
              </div>
            </form>
            <p className="mt-2 text-xs text-ink/55">Sama tilinumero päivittää tilin nimen.</p>
          </Panel>
        </section>
      </div>

      <section id="fennoa" className="mt-10">
        <SectionTitle>Laskentakohde Fennoassa</SectionTitle>
        <Panel>
          <p className="text-sm text-ink/70">
            Fennoa käyttää laskentakohteelle omaa dimensiotaan (esimerkiksi dim1). Kun dimensio on annettu, laskentakohde viedään jokaiselle laskuriville.
            Jos kenttä on tyhjä, viedään tuotekoodi ja tili, ja Fennoa käyttää tuotteen omaa laskentakohdetta.
          </p>
          {ctx.can("owner") ? (
            <form action={saveFennoaDimAction} className="mt-3 flex flex-wrap items-end gap-3">
              <Field label="Dimensio" htmlFor="dim">
                <Input id="dim" name="dim" defaultValue={data.org.fennoa_cost_center_dim ?? ""} placeholder="dim1" maxLength={10} />
              </Field>
              <Button variant="secondary">Tallenna</Button>
            </form>
          ) : (
            <p className="mt-2 text-sm">Dimensio: {data.org.fennoa_cost_center_dim ?? "ei asetettu"}</p>
          )}
        </Panel>
      </section>
    </>
  );
}
