import Link from "next/link";
import { Button, EmptyState, Input, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { listCustomers } from "@/lib/registry/queries";
import { formatPhone } from "@/lib/validation/phone";

export const metadata = { title: "Asiakkaat" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireStaff();
  const rows = await ctx.run((tx) => listCustomers(tx, ctx.org.organizationId, { q: sp.q, limit: 300 }));

  return (
    <>
      <PageHeader title="Asiakkaat" actions={ctx.can("owner", "staff") ? <LinkButton href="/asiakkaat/uusi">Lisää asiakas</LinkButton> : null} />
      <form className="mb-5 flex flex-wrap gap-3" role="search">
        <label htmlFor="q" className="sr-only">
          Hae
        </label>
        <Input id="q" name="q" defaultValue={sp.q ?? ""} placeholder="Nimi, asiakasnumero, sähköposti tai puhelin" className="max-w-sm" />
        <Button variant="secondary">Hae</Button>
      </form>
      {rows.length === 0 ? (
        <EmptyState title={sp.q ? "Ei hakutuloksia" : "Ei asiakkaita"}>
          {sp.q ? "Kokeile toista hakua." : "Asiakkaat siirretään mittarilukema.fi:n varmuuskopiosta, kun se on saatu."}
        </EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Nimi</Th>
              <Th>Asiakasnumero</Th>
              <Th>Kiinteistöt</Th>
              <Th>Puhelin</Th>
              <Th>Sähköposti</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="row-link hover:bg-cloud/50">
                <Td>
                  <Link href={`/asiakkaat/${c.id}`} className="row-link-main font-semibold">
                    {c.name}
                  </Link>
                </Td>
                <Td className="tabular">{c.customer_number ?? "–"}</Td>
                <Td>{c.properties?.join(", ") ?? "–"}</Td>
                <Td className="tabular whitespace-nowrap">{formatPhone(c.phone)}</Td>
                <Td>{c.email ?? "–"}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
