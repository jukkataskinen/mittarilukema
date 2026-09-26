import Link from "next/link";
import { Button, EmptyState, Field, Input, PageHeader, Panel, SectionTitle, Table, Td, Textarea, Th } from "@/components/ui";
import { FormError } from "@/components/FormError";
import { requireRole } from "@/lib/auth/current-user";
import { formatDateTime } from "@/lib/format";
import { createSwapBatchAction } from "./actions";

export const metadata = { title: "Mittarinvaihdot" };

export default async function SwapBatchesPage({ searchParams }: { searchParams: Promise<{ virhe?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireRole("owner", "staff");
  const batches = await ctx.run((tx) =>
    tx.query<{ id: string; name: string; created_at: string; total: number; ready: number; errors: number; applied: number; skipped: number }>(
      `select b.id, b.name, b.created_at, count(r.id)::int as total,
              count(*) filter (where r.status = 'ready')::int as ready, count(*) filter (where r.status = 'error')::int as errors,
              count(*) filter (where r.status = 'applied')::int as applied, count(*) filter (where r.status = 'skipped')::int as skipped
         from ml_meter_swap_batches b left join ml_meter_swap_rows r on r.batch_id = b.id
        where b.organization_id = $1 group by b.id order by b.created_at desc`,
      [ctx.org.organizationId],
    ),
  );

  return (
    <>
      <PageHeader
        title="Mittarinvaihdot"
        subtitle="Etäluettavien mittarien vaihtokampanja: asentajan lista eräksi, tarkistus ja kirjaus rekisteriin."
      />
      <FormError message={sp.virhe} />

      <Panel>
        <SectionTitle>Uusi erä</SectionTitle>
        <form action={createSwapBatchAction} className="grid gap-4">
          <Field label="Erän nimi" htmlFor="name" hint="Esimerkiksi asentaja ja viikko.">
            <Input id="name" name="name" maxLength={200} />
          </Field>
          <Field label="CSV-tiedosto" htmlFor="file" hint="Puolipiste, pilkku tai sarkain erottimena. Excelistä: Tallenna nimellä, CSV.">
            <input id="file" name="file" type="file" accept=".csv,text/csv,text/plain" className="text-sm" />
          </Field>
          <Field label="Tai liitä rivit" htmlFor="csv">
            <Textarea id="csv" name="csv" rows={5} placeholder={"Vanha mittari;Vaihtopäivä;Loppulukema;Uusi mittari;Aloituslukema\n123;15.9.2026;4521,3;WM2026001;0"} />
          </Field>
          <div className="rounded-xl border border-line bg-cloud/40 p-4 text-sm text-ink/70">
            <p className="font-semibold text-ink">Sarakkeet</p>
            <p className="mt-1">
              Pakolliset: Vanha mittari, Vaihtopäivä, Loppulukema, Uusi mittari. Valinnaiset: Aloituslukema (oletus 0), Käyttöpaikka (tunnus, jos sama
              mittarinumero on useassa paikassa tai vanhan numero puuttuu) ja Lukutapa (oletus etäluettava).
            </p>
            <p className="mt-2">Mitään ei kirjata vielä. Jokainen rivi tarkistetaan, ja näet ennen kirjausta, mitkä ovat valmiita ja mitkä korjattavia.</p>
          </div>
          <div>
            <Button>Lataa ja tarkista</Button>
          </div>
        </form>
      </Panel>

      <section className="mt-8">
        <SectionTitle>Erät</SectionTitle>
        {batches.length === 0 ? (
          <EmptyState title="Ei eriä">Ladattu erä näkyy tässä tiloineen.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Erä</Th>
                <Th>Ladattu</Th>
                <Th numeric>Rivejä</Th>
                <Th numeric>Kirjattu</Th>
                <Th numeric>Valmiina</Th>
                <Th numeric>Korjattavia</Th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id}>
                  <Td>
                    <Link href={`/mittarinvaihdot/${b.id}`} className="font-semibold hover:text-sky">
                      {b.name}
                    </Link>
                  </Td>
                  <Td className="whitespace-nowrap">{formatDateTime(b.created_at)}</Td>
                  <Td numeric>{b.total}</Td>
                  <Td numeric>{b.applied}</Td>
                  <Td numeric>{b.ready}</Td>
                  <Td numeric className={b.errors ? "text-coral" : undefined}>{b.errors}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </>
  );
}
