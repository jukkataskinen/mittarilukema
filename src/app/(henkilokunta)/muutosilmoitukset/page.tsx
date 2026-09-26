import Link from "next/link";
import { Badge, Button, EmptyState, Notice, PageHeader, Panel, Table, Tabs, Td, Th } from "@/components/ui";
import { changeFormUrl, qrSvg } from "@/lib/change-requests/qr";
import { rotateFormTokenAction } from "./actions";
import { requireRole } from "@/lib/auth/current-user";
import { formatDate, formatDateTime } from "@/lib/format";
import { KIND_SHORT, REQUEST_STATUS, type ChangeKind } from "@/lib/change-requests";

export const metadata = { title: "Muutosilmoitukset" };

const VIEWS: Record<string, { label: string; statuses: string[] }> = {
  avoimet: { label: "Avoimet", statuses: ["new", "in_progress"] },
  kasitellyt: { label: "Käsitellyt", statuses: ["done", "rejected"] },
};

export default async function ChangeRequestsPage({ searchParams }: { searchParams: Promise<{ nayta?: string; lomake?: string }> }) {
  const sp = await searchParams;
  const view = sp.nayta && sp.nayta in VIEWS ? sp.nayta : "avoimet";
  const ctx = await requireRole("owner", "staff");
  const [org] = await ctx.run((tx) =>
    tx.query<{ change_form_token: string }>("select change_form_token from ml_organizations where id = $1", [ctx.org.organizationId]),
  );
  const formUrl = await changeFormUrl(org.change_form_token);
  const svg = await qrSvg(formUrl);
  const rows = await ctx.run((tx) =>
    tx.query<{ id: string; kind: ChangeKind; change_date: string | null; place_text: string; street_address: string | null; submitter_name: string; status: string; created_at: string }>(
      `select c.id, c.kind, c.change_date::text, c.place_text, p.street_address, c.submitter_name, c.status, c.created_at
         from ml_change_requests c left join ml_properties p on p.id = c.property_id
        where c.organization_id = $1 and c.status = any($2::text[])
        order by c.created_at desc limit 300`,
      [ctx.org.organizationId, VIEWS[view].statuses],
    ),
  );

  return (
    <>
      <PageHeader
        title="Muutosilmoitukset"
        subtitle="Asiakkaiden ilmoitukset kaupoista, muutoista ja laskutustiedoista."
      />
      {sp.lomake === "uusi" ? (
        <div className="mb-5">
          <Notice tone="warn" title="Lomakkeelle vaihdettiin uusi osoite. Vanha osoite ja QR-koodi eivät enää toimi." />
        </div>
      ) : null}
      <Panel className="mb-8">
        <div className="flex flex-wrap items-start gap-6">
          {/* QR-koodi luodaan palvelimella lomakkeen osoitteesta; sisältö ei tule käyttäjältä. */}
          <div className="w-32 shrink-0 [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
          <div className="min-w-0 flex-1">
            <p className="font-bold">Lomake asiakkaille</p>
            <p className="mt-1 text-sm text-ink/70">
              Asiakas ilmoittaa kaupasta, muutosta tai laskutustietojen muutoksesta tällä lomakkeella. Lisää QR-koodi laskupohjaan tai tiedotteeseen.
              Lomake ei näytä rekisteristä mitään.
            </p>
            <p className="mt-3 break-all text-sm">
              <a href={formUrl} target="_blank" rel="noreferrer" className="font-semibold text-sky hover:underline">
                {formUrl}
              </a>
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-4 text-sm font-semibold">
              <a href="/api/muutoslomake/qr?muoto=png" className="text-sky hover:underline">
                Lataa QR (PNG)
              </a>
              <a href="/api/muutoslomake/qr" className="text-sky hover:underline">
                Lataa QR (SVG, tulostukseen)
              </a>
              {ctx.can("owner") ? (
                <form action={rotateFormTokenAction}>
                  <Button variant="secondary">Vaihda osoite</Button>
                </form>
              ) : null}
            </div>
          </div>
        </div>
      </Panel>
      <Tabs active={view} items={Object.entries(VIEWS).map(([k, v]) => ({ key: k, label: v.label, href: `/muutosilmoitukset?nayta=${k}` }))} />
      {rows.length === 0 ? (
        <EmptyState title={view === "avoimet" ? "Ei avoimia ilmoituksia" : "Ei käsiteltyjä ilmoituksia"} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Saapui</Th>
              <Th>Ilmoitus</Th>
              <Th>Käyttöpaikka</Th>
              <Th>Ilmoittaja</Th>
              <Th>Tila</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const st = REQUEST_STATUS[r.status];
              return (
                <tr key={r.id}>
                  <Td className="whitespace-nowrap">{formatDateTime(r.created_at)}</Td>
                  <Td>
                    <Link href={`/muutosilmoitukset/${r.id}`} className="font-semibold hover:text-sky">
                      {KIND_SHORT[r.kind]}
                    </Link>
                    {r.change_date ? <span className="block text-xs text-ink/55">{formatDate(r.change_date)}</span> : null}
                  </Td>
                  <Td>
                    {r.street_address ?? r.place_text}
                    {!r.street_address ? <span className="block text-xs text-amber">Kohdistamatta</span> : null}
                  </Td>
                  <Td>{r.submitter_name}</Td>
                  <Td>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </>
  );
}
