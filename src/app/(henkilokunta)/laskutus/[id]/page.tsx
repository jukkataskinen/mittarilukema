import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, EmptyState, Input, Notice, PageHeader, Stat, Table, Tabs, Td, Th } from "@/components/ui";
import { FormError } from "@/components/FormError";
import { requireRole } from "@/lib/auth/current-user";
import { getRun, listRunInvoices, scopeLabel } from "@/lib/billing/queries";
import { formatDate, formatDateTime, formatEur, formatNumber } from "@/lib/format";
import { approveRunAction, deleteRunAction } from "../actions";

export const metadata = { title: "Laskutusajo" };

const FILTERS = [
  { key: "kaikki", label: "Kaikki", filter: "all" },
  { key: "huomautukset", label: "Huomautukset", filter: "issues" },
  { key: "pois", label: "Jätetty pois", filter: "excluded" },
] as const;

export default async function RunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireRole("owner", "staff");
  const orgId = ctx.org.organizationId;
  const active = FILTERS.find((f) => f.key === sp.nayta) ?? FILTERS[0];
  const data = await ctx.run(async (tx) => {
    const run = await getRun(tx, orgId, id);
    if (!run) return null;
    return { run, invoices: await listRunInvoices(tx, orgId, id, active.filter, sp.q) };
  });
  if (!data) notFound();
  const { run, invoices } = data;
  const draft = run.status === "draft";
  const tabHref = (key: string) => `/laskutus/${id}${key === "kaikki" ? "" : `?nayta=${key}`}`;

  return (
    <>
      <PageHeader
        title={`Laskutus ${formatDate(run.period_start)} – ${formatDate(run.period_end)}`}
        subtitle={[scopeLabel(run), run.note].filter(Boolean).join(" · ")}
        back={{ href: "/laskutus", label: "Laskutus" }}
        actions={draft ? <Badge tone="warn">Luonnos</Badge> : <Badge tone="ok">Hyväksytty</Badge>}
      />
      <FormError message={sp.virhe} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Laskuja" value={run.invoices - run.excluded} />
        <Stat label="Huomautuksia" value={run.with_issues} tone={run.with_issues ? "alert" : "ok"} href={tabHref("huomautukset")} />
        <Stat label="Veroton" value={formatEur(run.net_eur)} />
        <Stat label="Yhteensä (sis. alv)" value={formatEur(run.gross_eur)} />
      </div>

      <div className="mt-6">
        {draft ? (
          <Notice tone="info" title="Luonnos">
            Tarkista huomautukset. Laskun voi jättää pois ajosta laskun sivulla. Jos rekisteriin tai lukemiin tehdään korjauksia, poista luonnos ja laske uudelleen.
            Hyväksytty ajo lukitaan. Fennoaan ei lähetetä mitään.
          </Notice>
        ) : (
          <Notice tone="ok" title="Hyväksytty">
            {run.approved_by_name ?? "Käyttäjä"} hyväksyi ajon {formatDateTime(run.approved_at)}. Laskuja ei ole lähetetty Fennoaan.
          </Notice>
        )}
      </div>

      {draft ? (
        <div className="mt-4 flex flex-wrap gap-3">
          <form action={approveRunAction}>
            <input type="hidden" name="runId" value={id} />
            <Button>Hyväksy ajo</Button>
          </form>
          <form action={deleteRunAction}>
            <input type="hidden" name="runId" value={id} />
            <Button variant="secondary">Poista luonnos</Button>
          </form>
        </div>
      ) : null}

      <div className="mt-8">
        <Tabs active={active.key} items={FILTERS.map((f) => ({ key: f.key, label: f.label, href: tabHref(f.key) }))} />
        <form className="mb-4 flex gap-3" role="search">
          {active.key !== "kaikki" ? <input type="hidden" name="nayta" value={active.key} /> : null}
          <label htmlFor="q" className="sr-only">
            Hae
          </label>
          <Input id="q" name="q" defaultValue={sp.q ?? ""} placeholder="Osoite, asiakas, asiakasnumero tai Unes" className="max-w-sm" />
          <Button variant="secondary">Hae</Button>
        </form>
        {invoices.length === 0 ? (
          <EmptyState title="Ei laskuja tällä rajauksella" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Kiinteistö</Th>
                <Th>Maksaja</Th>
                <Th numeric>Kulutus m³</Th>
                <Th numeric>Veroton</Th>
                <Th numeric>Yhteensä</Th>
                <Th>Huomautukset</Th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id} className={`row-link hover:bg-cloud/50 ${i.status === "excluded" ? "text-ink/45" : ""}`}>
                  <Td>
                    <Link href={`/laskutus/${id}/${i.id}`} className="row-link-main font-semibold">
                      {i.street_address}
                    </Link>
                    {i.legacy_id ? <span className="block text-xs text-ink/50">Unes {i.legacy_id}</span> : null}
                  </Td>
                  <Td>
                    {i.customer_name ?? <Badge tone="alert">Puuttuu</Badge>}
                    {i.customer_number ? <span className="block text-xs text-ink/50">Asiakasnro {i.customer_number}</span> : null}
                  </Td>
                  <Td numeric>{formatNumber(i.water_m3)}</Td>
                  <Td numeric>{formatEur(i.net_eur)}</Td>
                  <Td numeric>{formatEur(i.gross_eur)}</Td>
                  <Td>
                    {i.status === "excluded" ? <Badge>Jätetty pois</Badge> : null}
                    {i.status !== "excluded" && i.issues.length ? (
                      <span className="text-sm text-coral">{i.issues.length === 1 ? i.issues[0] : `${i.issues.length} huomautusta`}</span>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </>
  );
}
