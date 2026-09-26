import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, DefinitionList, Notice, EmptyState, LinkButton, PageHeader, Panel, SectionTitle, Table, Td, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { getCustomer } from "@/lib/registry/queries";
import { CONTRACT_ROLE, CUSTOMER_KIND } from "@/lib/labels";
import { formatDate, formatDateTime, isoDateHelsinki } from "@/lib/format";
import { customerCommunications } from "@/lib/communications";
import { formatPhone } from "@/lib/validation/phone";
import { CHANNEL_LABEL, channelProblems, isInvoiceChannel } from "@/lib/fennoa/channel";

export const metadata = { title: "Asiakas" };

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireStaff();
  const data = await ctx.run(async (tx) => {
    const d = await getCustomer(tx, ctx.org.organizationId, id);
    return d ? { ...d, log: await customerCommunications(tx, ctx.org.organizationId, id) } : null;
  });
  if (!data) notFound();
  const { customer: c, contracts, log } = data;
  const today = isoDateHelsinki();
  const problems = channelProblems(c);
  const address = [c.billing_street, [c.billing_postal_code, c.billing_city].filter(Boolean).join(" ")].filter(Boolean).join(", ");

  return (
    <>
      <PageHeader
        title={c.name}
        subtitle={c.customer_number ? `Asiakasnumero ${c.customer_number}` : undefined}
        back={{ href: "/asiakkaat", label: "Asiakkaat" }}
        actions={ctx.can("owner", "staff") ? <LinkButton href={`/asiakkaat/${id}/muokkaa`} variant="secondary">Muokkaa</LinkButton> : null}
      />
      <Panel>
        <DefinitionList
          items={[
            { label: "Asiakastyyppi", value: CUSTOMER_KIND[c.kind] },
            ...(c.business_id ? [{ label: "Y-tunnus", value: c.business_id }] : []),
            { label: "Puhelin", value: c.phone ? formatPhone(c.phone) : null },
            { label: "Sähköposti", value: c.email },
            { label: "Laskutusosoite", value: address || null },
            {
              label: "Laskukanava",
              value: c.invoice_channel && isInvoiceChannel(c.invoice_channel) ? (
                <>
                  {CHANNEL_LABEL[c.invoice_channel]}
                  {c.invoice_channel_source ? <span className="block text-xs text-ink/55">Lähde: {c.invoice_channel_source}</span> : null}
                </>
              ) : (
                <Badge tone="alert">Ei asetettu</Badge>
              ),
            },
            {
              label: "Verkkolasku",
              value: c.einvoice_address ? `${c.einvoice_address}${c.einvoice_operator ? `, ${c.einvoice_operator}` : ""}` : null,
            },
            ...(c.notes ? [{ label: "Muistiinpanot", value: <span className="whitespace-pre-line">{c.notes}</span> }] : []),
          ]}
        />
      </Panel>
      {problems.length ? (
        <div className="mt-4">
          <Notice tone="warn" title="Laskua ei voi viedä Fennoaan">
            <ul className="list-disc pl-5">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </Notice>
        </div>
      ) : null}

      <section className="mt-8">
        <SectionTitle>Kiinteistöt</SectionTitle>
        {contracts.length === 0 ? (
          <EmptyState title="Ei sopimuksia">Sopimus lisätään kiinteistön sivulla.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Kiinteistö</Th>
                <Th>Rooli</Th>
                <Th>Voimassa</Th>
                <Th>Laskutus</Th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((k) => {
                const ended = k.ends_on !== null && k.ends_on < today;
                return (
                  <tr key={k.id} className={ended ? "text-ink/50" : undefined}>
                    <Td>
                      <Link href={`/kiinteistot/${k.property_id}`} className="font-semibold hover:text-sky">
                        {k.street_address}
                      </Link>
                      {k.city ? <span className="block text-xs text-ink/55">{k.city}</span> : null}
                    </Td>
                    <Td>{CONTRACT_ROLE[k.role]}</Td>
                    <Td className="tabular whitespace-nowrap">
                      {formatDate(k.starts_on)} – {k.ends_on ? formatDate(k.ends_on) : ""}
                    </Td>
                    <Td>{k.billed ? <Badge tone={ended ? "neutral" : "info"}>Maksaja</Badge> : "–"}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </section>
      <section className="mt-8">
        <SectionTitle>Lähetetyt</SectionTitle>
        {log.length === 0 ? (
          <EmptyState title="Ei lähetyksiä">Tähän kootaan asiakkaalle lähetetyt tiedotteet ja laskut sekä kanava, jota pitkin ne lähtivät.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Päivä</Th>
                <Th>Mitä</Th>
                <Th>Kanava</Th>
                <Th>Osoite</Th>
                <Th>Tila</Th>
              </tr>
            </thead>
            <tbody>
              {log.map((r, i) => (
                <tr key={`${r.href}-${i}`}>
                  <Td className="tabular whitespace-nowrap">{r.at ? formatDateTime(r.at) : "–"}</Td>
                  <Td>
                    <Link href={r.href} className="font-semibold hover:text-sky">
                      {r.title}
                    </Link>
                  </Td>
                  <Td>{r.channel}</Td>
                  <Td className="text-sm">{r.destination ?? "–"}</Td>
                  <Td>
                    <Badge tone={r.tone}>{r.status}</Badge>
                    {r.note ? <span className="mt-1 block text-xs text-ink/65">{r.note}</span> : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      {c.legacy_id ? <p className="mt-8 text-xs text-ink/45">Tunniste mittarilukema.fi:ssä: {c.legacy_id}</p> : null}
    </>
  );
}
