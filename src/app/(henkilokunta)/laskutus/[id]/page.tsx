import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, EmptyState, Field, Input, Notice, PageHeader, Panel, SectionTitle, Stat, Table, Tabs, Td, Th } from "@/components/ui";
import { FormError } from "@/components/FormError";
import { requireRole } from "@/lib/auth/current-user";
import { getRun, listRunInvoices, RUN_KIND, scopeLabel } from "@/lib/billing/queries";
import { formatDate, formatDateTime, formatEur, formatNumber } from "@/lib/format";
import { approveRunAction, deleteRunAction, exportRunAction } from "../actions";
import { CHANNEL_LABEL, isInvoiceChannel } from "@/lib/fennoa/channel";
import { fennoaEnvironment } from "@/lib/fennoa";
import { latestExports, runExportStatus } from "@/lib/fennoa/export";

export const metadata = { title: "Laskutusajo" };
// Fennoa-vienti lähettää laskuja erissä; yksi erä kestää noin 15 sekuntia.
export const maxDuration = 60;

const EXPORT_STATUS: Record<string, { label: string; tone: "ok" | "warn" | "alert" | "neutral" }> = {
  exported: { label: "Viety", tone: "ok" },
  pending: { label: "Kesken, tarkista Fennoasta", tone: "warn" },
  mismatch: { label: "Poikkeama", tone: "alert" },
  blocked: { label: "Estetty", tone: "alert" },
  failed: { label: "Virhe", tone: "alert" },
};
const iso = (d: Date) => d.toISOString().slice(0, 10);

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
    const env = fennoaEnvironment();
    const invoices = await listRunInvoices(tx, orgId, id, active.filter, sp.q);
    // Luonnoksen voi viedä testiympäristöön (mock tai test), tuotantoon vain hyväksytyn.
    if (!env || (run.status !== "approved" && env !== "mock" && env !== "test")) return { run, invoices, env, status: null, exports: new Map<string, Awaited<ReturnType<typeof latestExports>>[number]>() };
    const [status, rows] = await Promise.all([runExportStatus(tx, orgId, id, env), latestExports(tx, orgId, id, env)]);
    return { run, invoices, env, status, exports: new Map(rows.map((r) => [r.invoice_id, r])) };
  });
  if (!data) notFound();
  const { run, invoices, env, status, exports } = data;
  const today = new Date();
  const due = new Date(today.getTime() + 14 * 86_400_000);
  const summary = sp.viety !== undefined ? sp : null;
  const draft = run.status === "draft";
  const tabHref = (key: string) => `/laskutus/${id}${key === "kaikki" ? "" : `?nayta=${key}`}`;

  return (
    <>
      <PageHeader
        title={`Laskutus ${formatDate(run.period_start)} – ${formatDate(run.period_end)}`}
        subtitle={[RUN_KIND[run.kind], scopeLabel(run), run.note].filter(Boolean).join(" · ")}
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
            Hyväksytty ajo lukitaan. Luonnoksen voi viedä vain Fennoan testiympäristöön; kun luonnos poistetaan, sen vientitiedot poistuvat mukana.
          </Notice>
        ) : (
          <Notice tone="ok" title="Hyväksytty">
            {run.approved_by_name ?? "Käyttäjä"} hyväksyi ajon {formatDateTime(run.approved_at)}.
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

      {status && env ? (
        <section className="mt-8">
          <SectionTitle>Vienti Fennoaan {env === "test" ? "(testiympäristö)" : "(testitila, ei yhteyttä Fennoaan)"}</SectionTitle>
          <Panel>
            {summary ? (
              <div className="mb-4">
                <Notice tone={Number(summary.estetty) || Number(summary.poikkeama) || Number(summary.virhe) ? "warn" : "ok"} title="Vientierä käsitelty">
                  Viety {summary.viety}, estetty {summary.estetty}, poikkeama {summary.poikkeama}, virhe {summary.virhe}. Lähettämättä {summary.jaljella}.
                </Notice>
              </div>
            ) : null}
            <p className="text-sm text-ink/70">
              {draft ? "Tämä on laskutusajon luonnos: vienti on tarkoitettu kokeiluun Fennoan testiyritykseen. " : null}
              Laskut viedään Fennoaan luonnoksiksi, ja ne hyväksytään ja lähetetään Fennoassa. Laskukanava asetetaan jokaiselle laskulle asiakkaan kanavan mukaan,
              ja viennin jälkeen kanava luetaan Fennoasta takaisin. Lasku, jonka asiakkaalta puuttuu laskukanava tai sen tiedot, estetään eikä sitä lähetetä muuta kautta.
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-sm font-semibold">Laskukanavat tässä ajossa</p>
                <ul className="mt-2 grid gap-1 text-sm">
                  {status.byChannel.map((c) => (
                    <li key={c.channel ?? "none"} className="flex justify-between gap-4">
                      <span className={c.channel ? "" : "font-semibold text-coral"}>{c.channel && isInvoiceChannel(c.channel) ? CHANNEL_LABEL[c.channel] : "Laskukanava puuttuu"}</span>
                      <span className="tabular">{c.n}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-sm font-semibold">Viennin tila</p>
                <ul className="mt-2 grid gap-1 text-sm">
                  {Object.entries(EXPORT_STATUS).map(([k, v]) => (
                    <li key={k} className="flex justify-between gap-4">
                      <span>{v.label}</span>
                      <span className="tabular">{status.byStatus[k] ?? 0}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <form action={exportRunAction} className="mt-5 flex flex-wrap items-end gap-4">
              <input type="hidden" name="runId" value={id} />
              <Field label="Laskupäivä" htmlFor="invoiceDate">
                <Input id="invoiceDate" name="invoiceDate" type="date" defaultValue={iso(today)} required />
              </Field>
              <Field label="Eräpäivä" htmlFor="dueDate">
                <Input id="dueDate" name="dueDate" type="date" defaultValue={iso(due)} required />
              </Field>
              <Button>{env === "test" ? "Vie seuraavat 25 laskua Fennoan testiin" : "Kokeile vientiä testitilassa"}</Button>
            </form>
          </Panel>
        </section>
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
                {status ? <Th>Fennoa</Th> : null}
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
                    {i.period_start !== run.period_start || i.period_end !== run.period_end ? (
                      <span className="block text-xs font-semibold text-amber">
                        {i.period_end !== run.period_end ? "Loppulasku" : "Uusi maksaja"} {formatDate(i.period_start)} – {formatDate(i.period_end)}
                      </span>
                    ) : null}
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
                  {status ? (
                    <Td>
                      {(() => {
                        const e = exports.get(i.id);
                        if (!e) return i.status === "excluded" ? null : <span className="text-sm text-ink/50">Ei viety</span>;
                        const st = EXPORT_STATUS[e.status] ?? { label: e.status, tone: "neutral" as const };
                        return (
                          <>
                            <Badge tone={st.tone}>{st.label}</Badge>
                            {e.message ? <span className="mt-1 block text-xs text-ink/65">{e.message}</span> : null}
                          </>
                        );
                      })()}
                    </Td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </>
  );
}
