import Link from "next/link";
import { Badge, EmptyState, Input, LinkButton, PageHeader, Select, Button, Table, Td, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { listAreas, listProperties } from "@/lib/registry/queries";
import { CONNECTION_KIND } from "@/lib/labels";

export const metadata = { title: "Kiinteistöt" };

export default async function PropertiesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireStaff();
  const orgId = ctx.org.organizationId;
  const areaId = sp.alue && /^[0-9a-f-]{36}$/.test(sp.alue) ? sp.alue : undefined;
  const missingPayer = sp.maksaja === "puuttuu";
  const { rows, areas } = await ctx.run(async (tx) => ({
    rows: await listProperties(tx, orgId, { q: sp.q, areaId, missingPayer, limit: 300 }),
    areas: await listAreas(tx, orgId),
  }));

  return (
    <>
      <PageHeader
        title="Kiinteistöt"
        subtitle={missingPayer ? "Kiinteistöt, joilta puuttuu laskutettava sopimus" : undefined}
        actions={ctx.can("owner", "staff") ? <LinkButton href="/kiinteistot/uusi">Lisää kiinteistö</LinkButton> : null}
      />

      <form className="mb-5 flex flex-wrap gap-3" role="search">
        <label htmlFor="q" className="sr-only">
          Hae
        </label>
        <Input id="q" name="q" defaultValue={sp.q ?? ""} placeholder="Osoite, Unes, mittarinumero tai asiakas" className="max-w-sm" />
        {areas.length > 0 ? (
          <>
            <label htmlFor="alue" className="sr-only">
              Alue
            </label>
            <Select id="alue" name="alue" defaultValue={areaId ?? ""} className="max-w-56">
              <option value="">Kaikki alueet</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </>
        ) : null}
        {missingPayer ? <input type="hidden" name="maksaja" value="puuttuu" /> : null}
        <Button variant="secondary">Hae</Button>
      </form>

      {rows.length === 0 ? (
        <EmptyState title={sp.q || areaId || missingPayer ? "Ei hakutuloksia" : "Ei kiinteistöjä"}>
          {sp.q || areaId || missingPayer ? "Kokeile toista hakua." : "Tiedot siirretään mittarilukema.fi:n varmuuskopiosta, kun se on saatu."}
        </EmptyState>
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Osoite</Th>
                <Th>Alue</Th>
                <Th>Maksaja</Th>
                <Th>Liittymät</Th>
                <Th>Mittari</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="row-link hover:bg-cloud/50">
                  <Td>
                    <Link href={`/kiinteistot/${p.id}`} className="row-link-main font-semibold">
                      {p.street_address}
                    </Link>
                    <span className="block text-xs text-ink/55">{[p.postal_code, p.city].filter(Boolean).join(" ")}</span>
                  </Td>
                  <Td>{p.area_name ?? "–"}</Td>
                  <Td>{p.payer ?? <Badge tone="warn">Puuttuu</Badge>}</Td>
                  <Td className="whitespace-nowrap">{p.connections?.map((k) => CONNECTION_KIND[k]).join(", ") ?? "–"}</Td>
                  <Td className="tabular">{p.meter_numbers?.join(", ") ?? "–"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {rows.length >= 300 ? <p className="mt-3 text-sm text-ink/60">Näytetään 300 ensimmäistä. Tarkenna hakua.</p> : null}
        </>
      )}
    </>
  );
}
