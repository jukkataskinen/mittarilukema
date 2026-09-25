import Link from "next/link";
import { Badge, EmptyState, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { requireRole } from "@/lib/auth/current-user";
import { formatDate } from "@/lib/format";
import { ANNOUNCEMENT_STATUS as STATUS } from "@/lib/announcements";

export const metadata = { title: "Tiedotteet" };


export default async function AnnouncementsPage() {
  const ctx = await requireRole("owner", "staff");
  const rows = await ctx.run((tx) =>
    tx.query<{ id: string; title: string; status: string; created_at: string; email: number; letter: number; none: number }>(
      `select a.id, a.title, a.status, a.created_at,
              count(r.id) filter (where r.channel = 'email')::int as email,
              count(r.id) filter (where r.channel = 'letter')::int as letter,
              count(r.id) filter (where r.channel = 'none')::int as none
         from ml_announcements a left join ml_announcement_recipients r on r.announcement_id = a.id
        where a.organization_id = $1 group by a.id order by a.created_at desc`,
      [ctx.org.organizationId],
    ),
  );
  return (
    <>
      <PageHeader
        title="Tiedotteet"
        subtitle="Tiedotteet asiakkaille sähköpostilla tai kirjeenä"
        actions={<LinkButton href="/tiedotteet/uusi">Uusi tiedote</LinkButton>}
      />
      {rows.length === 0 ? (
        <EmptyState title="Ei tiedotteita">Uusi tiedote lähtee sähköpostilla, ja ne, joilla ei ole sähköpostia, saavat sen kirjeenä.</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Otsikko</Th>
              <Th>Tila</Th>
              <Th numeric>Sähköposti</Th>
              <Th numeric>Kirje</Th>
              <Th>Luotu</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="row-link hover:bg-cloud/50">
                <Td>
                  <Link href={`/tiedotteet/${r.id}`} className="row-link-main font-semibold">
                    {r.title}
                  </Link>
                </Td>
                <Td>
                  <Badge tone={STATUS[r.status]?.tone ?? "neutral"}>{STATUS[r.status]?.label ?? r.status}</Badge>
                </Td>
                <Td numeric>{r.status === "draft" ? "–" : r.email}</Td>
                <Td numeric>{r.status === "draft" ? "–" : r.letter}</Td>
                <Td>{formatDate(r.created_at)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
