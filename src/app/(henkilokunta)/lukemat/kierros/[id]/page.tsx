import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Input, Notice, PageHeader, Select, Stat, Table, Td, Th } from "@/components/ui";
import { FormError } from "@/components/FormError";
import { requireStaff } from "@/lib/auth/current-user";
import { roundSheet } from "@/lib/readings/bulk";
import { listAreas } from "@/lib/registry/queries";
import { formatDate, formatNumber, isoDateHelsinki } from "@/lib/format";
import { saveRoundSheetAction } from "./actions";

export const metadata = { title: "Lukukierros" };

/**
 * Kierroksen lukulista: lukemat syötetään peräkkäin ja tallennetaan kerralla.
 * Tab-näppäin siirtyy seuraavaan mittariin. Mittarinlukija käyttää samaa
 * sivua; hänen lukemansa kirjataan hänen nimissään.
 */
export default async function RoundSheetPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireStaff();
  const orgId = ctx.org.organizationId;
  const areaId = sp.alue && /^[0-9a-f-]{36}$/.test(sp.alue) ? sp.alue : null;
  const data = await ctx.run(async (tx) => {
    const [round] = await tx.query<{ id: string; name: string; target_date: string; due_date: string; status: string }>(
      "select id, name, target_date::text, due_date::text, status from ml_reading_rounds where id = $1 and organization_id = $2",
      [id, orgId],
    );
    if (!round) return null;
    return { round, areas: await listAreas(tx, orgId), rows: await roundSheet(tx, { organizationId: orgId, roundId: id, targetDate: round.target_date, areaId, q: sp.q }) };
  });
  if (!data) notFound();
  const { round, areas, rows } = data;
  const done = rows.filter((r) => r.round_reading !== null).length;
  const today = isoDateHelsinki();
  const selfHref = `/lukemat/kierros/${id}${areaId || sp.q ? `?${new URLSearchParams({ ...(areaId ? { alue: areaId } : {}), ...(sp.q ? { q: sp.q } : {}) })}` : ""}`;

  return (
    <>
      <PageHeader
        title={round.name}
        subtitle={`Lukemapäivä ${formatDate(round.target_date)}, viimeistään ${formatDate(round.due_date)}`}
        back={{ href: "/lukemat", label: "Lukemat" }}
        actions={round.status === "open" ? <Badge tone="info">Avoin</Badge> : <Badge>Suljettu</Badge>}
      />
      <FormError message={sp.virhe} />
      {sp.tallennettu ? (
        <div className="mb-5">
          <Notice tone={Number(sp.virheita) ? "warn" : "ok"} title={`Tallennettu ${sp.tallennettu} lukemaa.`}>
            {Number(sp.tarkistettavia) ? `${sp.tarkistettavia} poikkeaa aiemmista ja jää tarkistettavaksi. ` : ""}
            {Number(sp.virheita) ? `${sp.virheita} riviä ohitettiin (ei lukua tai päivälle on jo lukema).` : ""}
          </Notice>
        </div>
      ) : null}

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Mittareita" value={rows.length} />
        <Stat label="Luettu" value={done} tone="ok" />
        <Stat label="Puuttuu" value={rows.length - done} tone={rows.length - done ? "warn" : "ok"} />
      </div>

      <form className="mb-4 flex flex-wrap gap-3" role="search">
        <label htmlFor="q" className="sr-only">
          Hae
        </label>
        <Input id="q" name="q" defaultValue={sp.q ?? ""} placeholder="Osoite, Unes tai mittari" className="max-w-xs" />
        {areas.length ? (
          <>
            <label htmlFor="alue" className="sr-only">
              Alue
            </label>
            <Select id="alue" name="alue" defaultValue={areaId ?? ""} className="max-w-56">
              <option value="">Kaikki alueet</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </>
        ) : null}
        <Button variant="secondary">Näytä</Button>
      </form>

      {round.status !== "open" ? (
        <Notice tone="info" title="Kierros on suljettu">Lukemia voi kirjata kiinteistön sivulla.</Notice>
      ) : (
        <form action={saveRoundSheetAction}>
          <input type="hidden" name="roundId" value={id} />
          <input type="hidden" name="backTo" value={selfHref} />
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="readOn" className="text-sm font-semibold">
                Lukemapäivä
              </label>
              <Input id="readOn" name="readOn" type="date" defaultValue={today} max={today} required className="mt-1.5 w-44" />
            </div>
            <Button>Tallenna lukemat</Button>
          </div>
          <Table>
            <thead>
              <tr>
                <Th>Kiinteistö</Th>
                <Th>Mittari</Th>
                <Th numeric>Edellinen</Th>
                <Th>Kierroksen lukema</Th>
                <Th>Uusi lukema</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.meter_id} className={r.round_reading ? "bg-moss-soft/40" : undefined}>
                  <Td>
                    <Link href={`/kiinteistot/${r.property_id}`} className="font-semibold hover:text-sky" tabIndex={-1}>
                      {r.street_address}
                    </Link>
                    <span className="block text-xs text-ink/50">{[r.area_name, r.legacy_id ? `Unes ${r.legacy_id}` : null].filter(Boolean).join(" · ")}</span>
                  </Td>
                  <Td className="tabular">
                    {r.meter_number ?? "–"}
                    {r.read_method === "remote" ? <span className="block text-xs text-ink/50">Etäluettava</span> : null}
                  </Td>
                  <Td numeric>
                    {r.previous_reading ? formatNumber(r.previous_reading) : "–"}
                    {r.previous_read_on ? <span className="block text-xs text-ink/50">{formatDate(r.previous_read_on)}</span> : null}
                  </Td>
                  <Td className="tabular">
                    {r.round_reading ? (
                      <>
                        {formatNumber(r.round_reading)} <span className="text-xs text-ink/50">{formatDate(r.round_read_on)}</span>
                        {r.round_status === "needs_review" ? <Badge tone="alert">Tarkistettava</Badge> : null}
                      </>
                    ) : (
                      "–"
                    )}
                  </Td>
                  <Td>
                    <label htmlFor={`r_${r.meter_id}`} className="sr-only">
                      Lukema, {r.street_address}
                    </label>
                    <input
                      id={`r_${r.meter_id}`}
                      name={`r_${r.meter_id}`}
                      inputMode="decimal"
                      autoComplete="off"
                      className="min-h-10 w-32 rounded-lg border border-line bg-paper px-3 text-right tabular focus:border-sky focus:outline-none"
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="mt-4">
            <Button>Tallenna lukemat</Button>
          </div>
        </form>
      )}
    </>
  );
}
