import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Notice, PageHeader, Stat, Table, Td, Th, Tabs } from "@/components/ui";
import { FormError } from "@/components/FormError";
import { requireRole } from "@/lib/auth/current-user";
import { formatDate, formatNumber } from "@/lib/format";
import { READ_METHOD } from "@/lib/labels";
import { APPLY_CHUNK, SWAP_STATUS } from "@/lib/meters/campaign";
import { applySwapBatchAction, deleteSwapBatchAction, recheckSwapBatchAction } from "../actions";

export const metadata = { title: "Mittarinvaihtojen erä" };
export const maxDuration = 60;

export default async function SwapBatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireRole("owner", "staff");
  const tila = sp.tila && sp.tila in SWAP_STATUS ? sp.tila : null;
  const data = await ctx.run(async (tx) => {
    const [batch] = await tx.query<{ id: string; name: string; filename: string | null }>(
      "select id, name, filename from ml_meter_swap_batches where organization_id = $1 and id = $2",
      [ctx.org.organizationId, id],
    );
    if (!batch) return null;
    const counts = await tx.query<{ status: string; n: number }>("select status, count(*)::int as n from ml_meter_swap_rows where batch_id = $1 group by status", [id]);
    const rows = await tx.query<{
      id: string; row_no: number; old_meter_number: string | null; place_code: string | null; change_date: string | null; final_reading: string | null;
      new_meter_number: string | null; start_reading: string | null; read_method: string | null; status: string; message: string | null;
      property_id: string | null; street_address: string | null;
    }>(
      `select r.id, r.row_no, r.old_meter_number, r.place_code, r.change_date::text, r.final_reading::text, r.new_meter_number, r.start_reading::text,
              r.read_method, r.status, r.message, p.id as property_id, p.street_address
         from ml_meter_swap_rows r
         left join ml_meters m on m.id = r.old_meter_id
         left join ml_connections k on k.id = m.connection_id
         left join ml_properties p on p.id = k.property_id
        where r.batch_id = $1 and ($2::text is null or r.status = $2)
        order by case r.status when 'error' then 0 when 'ready' then 1 when 'skipped' then 2 else 3 end, r.row_no`,
      [id, tila],
    );
    return { batch, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) as Record<string, number>, rows };
  });
  if (!data) notFound();
  const { batch, counts, rows } = data;
  const n = (s: string) => counts[s] ?? 0;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const done = sp.kirjattu !== undefined;

  return (
    <>
      <PageHeader title={batch.name} subtitle={batch.filename ?? undefined} back={{ href: "/mittarinvaihdot", label: "Mittarinvaihdot" }} />
      <FormError message={sp.virhe} />
      {done ? (
        <div className="mb-5">
          <Notice tone={Number(sp.epaonnistui) ? "warn" : "ok"} title={`Kirjattiin ${sp.kirjattu} vaihtoa.`}>
            {Number(sp.epaonnistui) ? `${sp.epaonnistui} riviä ei voitu kirjata; ne on merkitty korjattaviksi. ` : ""}
            {Number(sp.jaljella) ? `${sp.jaljella} valmista riviä odottaa vielä: jatka kirjausta.` : ""}
          </Notice>
        </div>
      ) : null}
      {sp.tarkistettu ? (
        <div className="mb-5">
          <Notice tone="ok" title="Erä tarkistettu uudelleen." />
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Rivejä" value={total} />
        <Stat label="Kirjattu" value={n("applied")} tone="ok" />
        <Stat label="Valmiina" value={n("ready")} tone="info" />
        <Stat label="Korjattavia" value={n("error")} tone={n("error") ? "alert" : undefined} />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {n("ready") ? (
          <form action={applySwapBatchAction}>
            <input type="hidden" name="batchId" value={id} />
            <Button>Kirjaa valmiit ({Math.min(n("ready"), APPLY_CHUNK)}{n("ready") > APPLY_CHUNK ? ` / ${n("ready")}` : ""})</Button>
          </form>
        ) : null}
        {n("error") || n("ready") ? (
          <form action={recheckSwapBatchAction}>
            <input type="hidden" name="batchId" value={id} />
            <Button variant="secondary">Tarkista uudelleen</Button>
          </form>
        ) : null}
        {!n("applied") ? (
          <form action={deleteSwapBatchAction}>
            <input type="hidden" name="batchId" value={id} />
            <Button variant="secondary">Poista erä</Button>
          </form>
        ) : null}
      </div>
      <p className="mt-2 text-xs text-ink/55">
        Kirjaus poistaa vanhan mittarin loppulukemalla, asentaa uuden samalle liittymälle ja kirjaa tapahtuman käyttöpaikalle. Korjaa korjattavat rivit
        rekisterissä (esimerkiksi puuttuva lukema tai mittarinumero) ja tarkista erä uudelleen.
      </p>

      <div className="mt-6">
        <Tabs
          active={tila ?? "all"}
          items={[
            { key: "all", href: `/mittarinvaihdot/${id}`, label: `Kaikki (${total})` },
            ...Object.entries(SWAP_STATUS).map(([k, v]) => ({ key: k, href: `/mittarinvaihdot/${id}?tila=${k}`, label: `${v.label} (${n(k)})` })),
          ]}
        />
      </div>
      <Table>
        <thead>
          <tr>
            <Th numeric>Rivi</Th>
            <Th>Käyttöpaikka</Th>
            <Th>Vanha mittari</Th>
            <Th>Vaihtopäivä</Th>
            <Th numeric>Loppulukema</Th>
            <Th>Uusi mittari</Th>
            <Th numeric>Aloitus</Th>
            <Th>Tila</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const st = SWAP_STATUS[r.status] ?? { label: r.status, tone: "neutral" as const };
            return (
              <tr key={r.id}>
                <Td numeric>{r.row_no}</Td>
                <Td>
                  {r.property_id ? (
                    <Link href={`/kiinteistot/${r.property_id}`} className="font-semibold hover:text-sky">
                      {r.street_address}
                    </Link>
                  ) : (
                    (r.place_code ?? "–")
                  )}
                </Td>
                <Td className="tabular">{r.old_meter_number ?? "–"}</Td>
                <Td className="tabular whitespace-nowrap">{r.change_date ? formatDate(r.change_date) : "–"}</Td>
                <Td numeric>{r.final_reading ? formatNumber(r.final_reading) : "–"}</Td>
                <Td className="tabular">
                  {r.new_meter_number ?? "–"}
                  {r.read_method ? <span className="block text-xs text-ink/55">{READ_METHOD[r.read_method]}</span> : null}
                </Td>
                <Td numeric>{r.start_reading ? formatNumber(r.start_reading) : "–"}</Td>
                <Td>
                  <Badge tone={st.tone}>{st.label}</Badge>
                  {r.message ? <span className="mt-1 block max-w-xs text-xs text-ink/70">{r.message}</span> : null}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </>
  );
}
