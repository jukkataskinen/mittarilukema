import Link from "next/link";
import { Badge, Button, EmptyState, Field, Input, Notice, PageHeader, Panel, SectionTitle, Select, Table, Td, Th } from "@/components/ui";
import { FormError } from "@/components/FormError";
import { requireRole } from "@/lib/auth/current-user";
import { listRuns, scopeLabel } from "@/lib/billing/queries";
import { listAreas } from "@/lib/registry/queries";
import { formatDate, formatEur, formatNumber, isoDateHelsinki } from "@/lib/format";
import { createRunAction } from "./actions";

export const metadata = { title: "Laskutus" };

/** Kuukauden viimeinen päivä ISO-muodossa. */
const monthEnd = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

/**
 * Ehdotus seuraavaksi jaksoksi: edellisen ajon lopusta seuraavaan
 * laskutuskuukauden loppuun, tai ensimmäisellä kerralla kahden viimeisimmän
 * laskutuskuukauden välinen jakso (Joutsa: 31.3. ja 30.9.).
 */
function suggestPeriod(months: number[], lastEnd: string | null, today: string): [string, string] {
  const ends: string[] = [];
  const year = Number(today.slice(0, 4));
  for (let y = year - 2; y <= year + 1; y++) for (const m of [...months].sort((a, b) => a - b)) ends.push(monthEnd(y, m));
  if (lastEnd) return [lastEnd, ends.find((e) => e > lastEnd) ?? lastEnd];
  const due = ends.filter((e) => e <= today).at(-1) ?? ends[0];
  return [ends[ends.indexOf(due) - 1] ?? due, due];
}

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ virhe?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireRole("owner", "staff");
  const orgId = ctx.org.organizationId;
  const { runs, org, areas } = await ctx.run(async (tx) => ({
    runs: await listRuns(tx, orgId),
    areas: await listAreas(tx, orgId),
    org: (await tx.query<{ billing_method: string; billing_months: number[] }>("select billing_method, billing_months from ml_organizations where id = $1", [orgId]))[0],
  }));
  // Ehdotus oletusrajauksen (ilman aluetta tai kaikki) edellisestä ajosta; aluekohtaisilla ajoilla on oma jaksonsa.
  const lastMain = runs.find((r) => r.scope !== "area") ?? null;
  // Oletusrajaus: edellisen pääajon rajaus, jotta Joutsan "kaikki paitsi Rutalahti" pysyy valittuna.
  const scopeValue = (r: (typeof runs)[number] | null) =>
    !r ? "all" : r.scope === "except_area" ? `except:${r.area_id}` : r.scope === "area" ? `area:${r.area_id}` : r.scope;
  const defaultScope = scopeValue(lastMain);
  const [start, end] = suggestPeriod(org.billing_months, lastMain?.period_end ?? null, isoDateHelsinki());

  return (
    <>
      <PageHeader title="Laskutus" subtitle="Laskutusajo laskee jakson laskut kaikille kiinteistöille. Laskut tarkistetaan täällä, eikä mitään lähetetä Fennoaan." />
      <FormError message={sp.virhe} />

      {org.billing_method !== "actual" ? (
        <div className="mb-6">
          <Notice tone="warn" title="Arviolaskutus ei ole vielä käytössä">
            Laskutusajo laskee toteutuneen kulutuksen. Arviolaskut ja vuositasaus tulevat myöhemmin.
          </Notice>
        </div>
      ) : null}

      <section>
        <SectionTitle>Laskutusajot</SectionTitle>
        {runs.length === 0 ? (
          <EmptyState title="Ei laskutusajoja">Luo ensimmäinen ajo alla.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Jakso</Th>
                <Th>Kiinteistöt</Th>
                <Th>Tila</Th>
                <Th numeric>Laskuja</Th>
                <Th numeric>Huomautuksia</Th>
                <Th numeric>Kulutus m³</Th>
                <Th numeric>Veroton</Th>
                <Th numeric>Yhteensä</Th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="row-link hover:bg-cloud/50">
                  <Td className="tabular whitespace-nowrap">
                    <Link href={`/laskutus/${r.id}`} className="row-link-main font-semibold">
                      {formatDate(r.period_start)} – {formatDate(r.period_end)}
                    </Link>
                  </Td>
                  <Td>{scopeLabel(r)}</Td>
                  <Td>{r.status === "approved" ? <Badge tone="ok">Hyväksytty</Badge> : <Badge tone="warn">Luonnos</Badge>}</Td>
                  <Td numeric>
                    {r.invoices - r.excluded}
                    {r.excluded ? <span className="text-ink/50"> (+{r.excluded} pois)</span> : null}
                  </Td>
                  <Td numeric className={r.with_issues ? "font-semibold text-coral" : undefined}>{r.with_issues}</Td>
                  <Td numeric>{formatNumber(r.water_m3)}</Td>
                  <Td numeric>{formatEur(r.net_eur)}</Td>
                  <Td numeric>{formatEur(r.gross_eur)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section className="mt-10 max-w-2xl">
        <SectionTitle>Uusi laskutusajo</SectionTitle>
        <Panel>
          <form action={createRunAction} className="grid gap-4 sm:grid-cols-2">
            <Field label="Edellinen lukemapäivä" htmlFor="periodStart" hint="Jakso alkaa seuraavasta päivästä.">
              <Input id="periodStart" name="periodStart" type="date" defaultValue={start} required />
            </Field>
            <Field label="Jakson loppu" htmlFor="periodEnd" hint="Lukemat kelpaavat 60 päivän ajan tämän jälkeen.">
              <Input id="periodEnd" name="periodEnd" type="date" defaultValue={end} required />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Kiinteistöt" htmlFor="scope" hint="Alue, jolla on eri laskutusjakso (esim. Rutalahti), ajetaan omana ajonaan.">
                <Select id="scope" name="scope" defaultValue={defaultScope}>
                  <option value="all">Kaikki kiinteistöt</option>
                  {areas.length ? <option value="no_area">Kiinteistöt ilman aluetta</option> : null}
                  {areas.length ? (
                    <optgroup label="Yksi alue">
                      {areas.map((a) => (
                        <option key={a.id} value={`area:${a.id}`}>
                          {a.name} ({a.property_count} kiint.)
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  {areas.length ? (
                    <optgroup label="Kaikki paitsi">
                      {areas.map((a) => (
                        <option key={a.id} value={`except:${a.id}`}>
                          Kaikki paitsi {a.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </Select>
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Muistiinpano" htmlFor="note">
                <Input id="note" name="note" placeholder="Esimerkiksi: kevään 2026 laskutus" />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Button>Laske laskut</Button>
            </div>
          </form>
        </Panel>
      </section>
    </>
  );
}
