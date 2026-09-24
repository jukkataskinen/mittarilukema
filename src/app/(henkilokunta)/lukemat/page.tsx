import Link from "next/link";
import { Button, EmptyState, Field, Input, Notice, PageHeader, Panel, SectionTitle, Tabs } from "@/components/ui";
import { FormError } from "@/components/FormError";
import { requireStaff } from "@/lib/auth/current-user";
import { listReadings, listRounds } from "@/lib/registry/queries";
import { formatDate, isoDateHelsinki } from "@/lib/format";
import { ReadingsTable } from "./ReadingsTable";
import { closeRoundAction, createRoundAction } from "./actions";
import { loadSms, SmsList } from "./SmsList";

export const metadata = { title: "Lukemat" };

const FILTERS = [
  { key: "kaikki", label: "Viimeisimmät", status: undefined },
  { key: "tarkistettava", label: "Tarkistettavat", status: "needs_review" },
  { key: "hylatty", label: "Hylätyt", status: "rejected" },
  { key: "tekstiviestit", label: "Tekstiviestit", status: undefined },
] as const;

export default async function ReadingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireStaff();
  const filter = FILTERS.find((f) => f.key === sp.tila) ?? FILTERS[0];
  const orgId = ctx.org.organizationId;
  const canManage = ctx.can("owner", "staff");
  const smsTab = filter.key === "tekstiviestit";
  const { rows, rounds, sms } = await ctx.run(async (tx) => ({
    rows: smsTab ? [] : await listReadings(tx, orgId, { status: filter.status, limit: 200 }),
    rounds: await listRounds(tx, orgId),
    sms: smsTab && canManage ? await loadSms(tx, orgId) : null,
  }));

  return (
    <>
      <PageHeader title="Lukemat" subtitle="Lukemat kirjataan kiinteistön sivulla mittarin kohdalla. Poikkeavat lukemat odottavat tässä tarkistusta." />
      <FormError message={sp.virhe} />

      <Tabs
        active={filter.key}
        items={FILTERS.filter((f) => f.key !== "tekstiviestit" || canManage).map((f) => ({
          key: f.key,
          label: f.label,
          href: f.key === "kaikki" ? "/lukemat" : `/lukemat?tila=${f.key}`,
        }))}
      />

      {sms ? (
        <SmsList data={sms} canManage={canManage} />
      ) : rows.length === 0 ? (
        <EmptyState title={filter.key === "tarkistettava" ? "Ei tarkistettavia lukemia" : "Ei lukemia"}>
          Lukemat tulevat myöhemmin myös etäluennasta ja tekstiviesteistä.
        </EmptyState>
      ) : (
        <ReadingsTable rows={rows} canReview={canManage} backTo={filter.key === "kaikki" ? "/lukemat" : `/lukemat?tila=${filter.key}`} />
      )}

      <section className="mt-10">
        <SectionTitle>Lukukierrokset</SectionTitle>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Panel>
            {rounds.length === 0 ? (
              <p className="text-sm text-ink/65">Ei kierroksia. Kierros kokoaa saman ajankohdan lukemat ja muistutukset.</p>
            ) : (
              <ul className="divide-y divide-line">
                {rounds.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                    <div>
                      <p className="font-semibold">{r.name}</p>
                      <p className="text-sm text-ink/60">
                        Lukemat {formatDate(r.target_date)}, viimeistään {formatDate(r.due_date)} · {r.reading_count} lukemaa
                      </p>
                    </div>
                    {r.status === "open" && canManage ? (
                      <div className="flex flex-wrap justify-end gap-2">
                        {/* Tavallinen POST-lomake: vastaus on ladattava tiedosto, ei sivu. */}
                        <form method="post" action={`/api/lukukierrokset/${r.id}/linkit`}>
                          <Button variant="secondary" title="Luo jokaiselle mittarille uuden linkin ja korvaa aiemmat">
                            Lataa lukemalinkit (CSV)
                          </Button>
                        </form>
                        <form method="post" action={`/api/lukukierrokset/${r.id}/linkit`}>
                          <input type="hidden" name="puuttuvat" value="1" />
                          <Button variant="secondary" title="Vain mittarit, joilta kierroksen lukema puuttuu; uudet linkit korvaavat niiden aiemmat">
                            Muistutuslista (CSV)
                          </Button>
                        </form>
                        <form action={closeRoundAction}>
                          <input type="hidden" name="roundId" value={r.id} />
                          <Button variant="secondary">Sulje</Button>
                        </form>
                      </div>
                    ) : (
                      <span className="text-sm text-ink/55">{r.status === "open" ? "Avoin" : "Suljettu"}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          {canManage ? (
            <Panel>
              <h3 className="font-semibold">Uusi lukukierros</h3>
              <form action={createRoundAction} className="mt-4 grid gap-4">
                <Field label="Nimi" htmlFor="round-name">
                  <Input id="round-name" name="name" placeholder="Syksy 2026" required />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Lukemapäivä" htmlFor="round-target">
                    <Input id="round-target" name="targetDate" type="date" defaultValue={isoDateHelsinki()} required />
                  </Field>
                  <Field label="Viimeistään" htmlFor="round-due">
                    <Input id="round-due" name="dueDate" type="date" required />
                  </Field>
                </div>
                <div>
                  <Button>Luo kierros</Button>
                </div>
              </form>
            </Panel>
          ) : (
            <Notice tone="info" title="Lukemien kirjaus">
              Hae kiinteistö <Link href="/kiinteistot" className="font-semibold text-sky">kiinteistölistasta</Link> ja kirjaa lukema mittarin kohdalla.
            </Notice>
          )}
        </div>
      </section>
    </>
  );
}
