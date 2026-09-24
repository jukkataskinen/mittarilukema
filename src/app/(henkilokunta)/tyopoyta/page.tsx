import Link from "next/link";
import { EmptyState, LinkButton, Notice, PageHeader, Panel, SectionTitle, Stat } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { dashboardStats, listReadings, listRounds } from "@/lib/registry/queries";
import { BILLING_METHOD, MONTHS } from "@/lib/labels";
import { formatDate } from "@/lib/format";
import { ReadingsTable } from "../lukemat/ReadingsTable";

export const metadata = { title: "Työpöytä" };

export default async function Dashboard() {
  const ctx = await requireStaff();
  const orgId = ctx.org.organizationId;
  const { stats, review, rounds, org } = await ctx.run(async (tx) => ({
    stats: await dashboardStats(tx, orgId),
    review: await listReadings(tx, orgId, { status: "needs_review", limit: 10 }),
    rounds: (await listRounds(tx, orgId)).filter((r) => r.status === "open"),
    org: (
      await tx.query<{ billing_method: string; billing_months: number[]; settlement_month: number | null }>(
        "select billing_method, billing_months, settlement_month from ml_organizations where id = $1",
        [orgId],
      )
    )[0],
  }));

  const billing =
    org.billing_method === "actual"
      ? `${BILLING_METHOD.actual}, laskutus ${org.billing_months.map((m) => `${MONTHS[m - 1]}kuussa`).join(" ja ")}`
      : `${BILLING_METHOD.estimate}${org.settlement_month ? `, tasaus ${MONTHS[org.settlement_month - 1]}kuussa` : ""}`;

  return (
    <>
      <PageHeader title={ctx.org.organizationName} subtitle={billing} />

      {stats.properties === 0 ? (
        <EmptyState
          title="Rekisteri on vielä tyhjä"
          action={ctx.can("owner", "staff") ? <LinkButton href="/kiinteistot/uusi">Lisää kiinteistö</LinkButton> : null}
        >
          Tiedot siirretään mittarilukema.fi:n varmuuskopiosta, kun se on saatu. Voit myös lisätä kiinteistöjä käsin.
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Kiinteistöt" value={stats.properties} href="/kiinteistot" />
          <Stat label="Asiakkaat" value={stats.customers} href="/asiakkaat" />
          <Stat label={`Mittarit (${stats.remote_meters} etäluettavaa)`} value={stats.meters} />
          <Stat label="Tarkistettavat lukemat" value={stats.needs_review} href="/lukemat?tila=tarkistettava" tone={stats.needs_review ? "alert" : "ok"} />
        </div>
      )}

      {stats.no_billed_contract > 0 ? (
        <div className="mt-6">
          <Notice tone="warn" title={`${stats.no_billed_contract} kiinteistöltä puuttuu laskutettava sopimus`}>
            Näille kiinteistöille ei synny laskua ennen kuin maksaja on kirjattu.{" "}
            <Link href="/kiinteistot?maksaja=puuttuu" className="font-semibold text-sky">
              Näytä kiinteistöt
            </Link>
          </Notice>
        </div>
      ) : null}

      <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="min-w-0">
          <SectionTitle actions={<Link href="/lukemat?tila=tarkistettava" className="text-sm font-semibold text-sky">Kaikki</Link>}>
            Tarkistettavat lukemat
          </SectionTitle>
          {review.length === 0 ? (
            <EmptyState title="Ei tarkistettavaa">Poikkeavat lukemat näkyvät tässä hyväksyttäviksi.</EmptyState>
          ) : (
            <ReadingsTable rows={review} canReview={ctx.can("owner", "staff")} backTo="/tyopoyta" />
          )}
        </section>
        <section className="min-w-0">
          <SectionTitle>Avoimet lukukierrokset</SectionTitle>
          <Panel>
            {rounds.length === 0 ? (
              <p className="text-sm text-ink/65">Ei avoimia kierroksia.</p>
            ) : (
              <ul className="divide-y divide-line">
                {rounds.map((r) => (
                  <li key={r.id} className="py-2.5 first:pt-0 last:pb-0">
                    <Link href={`/lukemat/kierros/${r.id}`} className="font-semibold hover:text-sky">
                      {r.name}
                    </Link>
                    <p className="text-sm text-ink/60">
                      Lukemat {formatDate(r.target_date)}, viimeistään {formatDate(r.due_date)} · {r.reading_count} lukemaa
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </section>
      </div>
    </>
  );
}
