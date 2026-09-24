import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Badge, Button, DefinitionList, EmptyState, Field, Input, LinkButton, Notice, PageHeader, Panel, SectionTitle, Select, Table, Td, Th } from "@/components/ui";
import { FormError } from "@/components/FormError";
import { requireStaff } from "@/lib/auth/current-user";
import { getProperty } from "@/lib/registry/queries";
import { BILLING_METHOD, CONNECTION_KIND, CONTRACT_ROLE, READ_METHOD } from "@/lib/labels";
import { formatDate, formatNumber, isoDateHelsinki } from "@/lib/format";
import { ReadingsTable } from "../../lukemat/ReadingsTable";
import { addReadingAction } from "../../lukemat/actions";
import { addConnectionAction, addContractAction, addMeterAction, disconnectAction, endContractAction } from "../actions";

export const metadata = { title: "Kiinteistö" };

const NOTICES: Record<string, { tone: "ok" | "warn"; text: string }> = {
  tallennettu: { tone: "ok", text: "Lukema tallennettu." },
  tarkistettava: { tone: "warn", text: "Lukema tallennettu, mutta se poikkeaa aiemmista ja jää tarkistettavaksi." },
};

/** Toissijaiset lomakkeet avautuvat pyydettäessä, jotta sivu pysyy luettavana. */
function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="group mt-4 rounded-xl border border-line bg-cloud/40 px-4 py-3">
      <summary className="cursor-pointer text-sm font-semibold text-sky">{label}</summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}

export default async function PropertyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireStaff();
  const orgId = ctx.org.organizationId;
  const canEdit = ctx.can("owner", "staff");
  const data = await ctx.run(async (tx) => {
    const detail = await getProperty(tx, orgId, id);
    if (!detail) return null;
    const customers = canEdit
      ? await tx.query<{ id: string; name: string; customer_number: string | null }>(
          "select id, name, customer_number from ml_customers where organization_id = $1 order by lower(name)",
          [orgId],
        )
      : [];
    const [org] = await tx.query<{ billing_method: string }>("select billing_method from ml_organizations where id = $1", [orgId]);
    const rounds = await tx.query<{ id: string; name: string }>(
      "select id, name from ml_reading_rounds where organization_id = $1 and status = 'open' order by target_date desc",
      [orgId],
    );
    return { ...detail, customers, org, rounds };
  });
  if (!data) notFound();
  const { property: p, connections, meters, contracts, readings, customers, rounds } = data;
  const back = `/kiinteistot/${id}`;
  const today = isoDateHelsinki();
  const activeConnections = connections.filter((c) => !c.disconnected_on);
  const notice = sp.ilmoitus ? NOTICES[sp.ilmoitus] : undefined;

  return (
    <>
      <PageHeader
        title={p.street_address}
        subtitle={[p.postal_code, p.city].filter(Boolean).join(" ") || undefined}
        back={{ href: "/kiinteistot", label: "Kiinteistöt" }}
        actions={canEdit ? <LinkButton href={`${back}/muokkaa`} variant="secondary">Muokkaa</LinkButton> : null}
      />
      <FormError message={sp.virhe} />
      {notice ? (
        <div className="mb-5">
          <Notice tone={notice.tone} title={notice.text} />
        </div>
      ) : null}

      <Panel>
        <DefinitionList
          items={[
            { label: "Alue", value: p.area_name },
            { label: "Kiinteistötunnus", value: p.property_code },
            { label: "Laskutustapa", value: p.billing_method ? BILLING_METHOD[p.billing_method] : `${BILLING_METHOD[data.org.billing_method]} (oletus)` },
            { label: "Arvioitu vuosikulutus", value: p.estimated_annual_m3 ? formatNumber(p.estimated_annual_m3, "m³") : null },
            ...(p.notes ? [{ label: "Muistiinpanot", value: <span className="whitespace-pre-line">{p.notes}</span> }] : []),
          ]}
        />
      </Panel>

      {/* Mittarit ja lukeman kirjaus */}
      <section className="mt-8">
        <SectionTitle>Mittarit</SectionTitle>
        {meters.length === 0 ? (
          <EmptyState title="Ei mittareita">
            {activeConnections.length === 0 ? "Lisää ensin liittymä, sitten mittari." : "Lisää mittari alla."}
          </EmptyState>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {meters.map((m) => {
              const conn = connections.find((c) => c.id === m.connection_id);
              return (
                <Panel key={m.id} className={m.removed_on ? "opacity-60" : undefined}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-lg font-bold tabular">{m.meter_number ?? "Numeroton mittari"}</p>
                      <p className="text-sm text-ink/60">
                        {READ_METHOD[m.read_method]} · {conn ? CONNECTION_KIND[conn.kind] : ""}
                        {m.location ? ` · ${m.location}` : ""}
                        {Number(m.multiplier) !== 1 ? ` · kerroin ${formatNumber(m.multiplier)}` : ""}
                      </p>
                    </div>
                    {m.removed_on ? <Badge>Poistettu {formatDate(m.removed_on)}</Badge> : <Badge tone="ok">Käytössä</Badge>}
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-ink/55">Viimeisin lukema</dt>
                      <dd className="tabular font-semibold">
                        {m.last_reading ? `${formatNumber(m.last_reading)} (${formatDate(m.last_read_on)})` : "–"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-ink/55">Asennettu</dt>
                      <dd className="tabular">
                        {formatDate(m.installed_on)}, {formatNumber(m.start_reading)}
                      </dd>
                    </div>
                    {m.removed_on ? (
                      <div>
                        <dt className="text-ink/55">Loppulukema</dt>
                        <dd className="tabular">{formatNumber(m.final_reading)}</dd>
                      </div>
                    ) : null}
                  </dl>
                  {!m.removed_on ? (
                    <form action={addReadingAction} className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4">
                      <input type="hidden" name="meterId" value={m.id} />
                      <input type="hidden" name="backTo" value={back} />
                      {rounds[0] ? <input type="hidden" name="roundId" value={rounds[0].id} /> : null}
                      <Field label="Lukema" htmlFor={`reading-${m.id}`}>
                        <Input id={`reading-${m.id}`} name="reading" inputMode="decimal" autoComplete="off" required />
                      </Field>
                      <Field label="Päivä" htmlFor={`readOn-${m.id}`}>
                        <Input id={`readOn-${m.id}`} name="readOn" type="date" defaultValue={today} max={today} required />
                      </Field>
                      <div className="col-span-2">
                        <Button>Kirjaa lukema</Button>
                      </div>
                    </form>
                  ) : null}
                </Panel>
              );
            })}
          </div>
        )}
        {canEdit && activeConnections.length > 0 ? (
          <Disclosure label="Lisää mittari tai vaihda mittari">
            <form action={addMeterAction} className="grid gap-4 sm:grid-cols-2">
              <input type="hidden" name="propertyId" value={id} />
              <Field label="Liittymä" htmlFor="connectionId">
                <Select id="connectionId" name="connectionId" required>
                  {activeConnections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {CONNECTION_KIND[c.kind]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Lukutapa" htmlFor="readMethod">
                <Select id="readMethod" name="readMethod" defaultValue="mechanical">
                  <option value="mechanical">{READ_METHOD.mechanical}</option>
                  <option value="remote">{READ_METHOD.remote}</option>
                </Select>
              </Field>
              <Field label="Mittarinumero" htmlFor="meterNumber">
                <Input id="meterNumber" name="meterNumber" autoComplete="off" />
              </Field>
              <Field label="Sijainti" htmlFor="location">
                <Input id="location" name="location" placeholder="Kellari, kaivo" />
              </Field>
              <Field label="Asennuspäivä" htmlFor="installedOn">
                <Input id="installedOn" name="installedOn" type="date" defaultValue={today} required />
              </Field>
              <Field label="Aloituslukema" htmlFor="startReading">
                <Input id="startReading" name="startReading" inputMode="decimal" defaultValue="0" required />
              </Field>
              {meters.some((m) => !m.removed_on) ? (
                <>
                  <Field label="Korvaa mittarin" htmlFor="replaceMeterId" hint="Vanha mittari poistetaan asennuspäivänä.">
                    <Select id="replaceMeterId" name="replaceMeterId" defaultValue="">
                      <option value="">Ei, lisätään uusi mittari</option>
                      {meters
                        .filter((m) => !m.removed_on)
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.meter_number ?? "Numeroton mittari"}
                          </option>
                        ))}
                    </Select>
                  </Field>
                  <Field label="Vanhan mittarin loppulukema" htmlFor="finalReading">
                    <Input id="finalReading" name="finalReading" inputMode="decimal" />
                  </Field>
                </>
              ) : null}
              <div className="sm:col-span-2">
                <Button>Tallenna mittari</Button>
              </div>
            </form>
          </Disclosure>
        ) : null}
      </section>

      {/* Maksaja ja sopimukset */}
      <section className="mt-10">
        <SectionTitle>Sopimukset</SectionTitle>
        {contracts.length === 0 ? (
          <EmptyState title="Ei sopimuksia">Kiinteistölle ei synny laskua ennen kuin maksaja on kirjattu.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Asiakas</Th>
                <Th>Rooli</Th>
                <Th>Voimassa</Th>
                <Th>Laskutus</Th>
                {canEdit ? <Th /> : null}
              </tr>
            </thead>
            <tbody>
              {contracts.map((c) => {
                const ended = c.ends_on !== null && c.ends_on < today;
                return (
                  <tr key={c.id} className={ended ? "text-ink/50" : undefined}>
                    <Td>
                      <Link href={`/asiakkaat/${c.customer_id}`} className="font-semibold hover:text-sky">
                        {c.customer_name}
                      </Link>
                    </Td>
                    <Td>{CONTRACT_ROLE[c.role]}</Td>
                    <Td className="tabular whitespace-nowrap">
                      {formatDate(c.starts_on)} – {c.ends_on ? formatDate(c.ends_on) : ""}
                    </Td>
                    <Td>{c.billed ? <Badge tone={ended ? "neutral" : "info"}>Maksaja</Badge> : "–"}</Td>
                    {canEdit ? (
                      <Td className="text-right">
                        {!c.ends_on ? (
                          <form action={endContractAction} className="inline-flex items-center gap-2">
                            <input type="hidden" name="contractId" value={c.id} />
                            <input type="hidden" name="propertyId" value={id} />
                            <label htmlFor={`end-${c.id}`} className="sr-only">
                              Päättymispäivä
                            </label>
                            <input id={`end-${c.id}`} name="endsOn" type="date" required className="rounded-lg border border-line px-2 py-1 text-sm" />
                            <button className="text-sm font-semibold text-sky">Päätä</button>
                          </form>
                        ) : null}
                      </Td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        {canEdit ? (
          <Disclosure label="Lisää sopimus">
            {customers.length === 0 ? (
              <p className="text-sm text-ink/70">
                Lisää ensin asiakas <Link href="/asiakkaat/uusi" className="font-semibold text-sky">asiakasrekisteriin</Link>.
              </p>
            ) : (
              <form action={addContractAction} className="grid gap-4 sm:grid-cols-2">
                <input type="hidden" name="propertyId" value={id} />
                <Field label="Asiakas" htmlFor="customerId">
                  <Select id="customerId" name="customerId" required defaultValue="">
                    <option value="" disabled>
                      Valitse asiakas
                    </option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.customer_number ? ` (${c.customer_number})` : ""}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Rooli" htmlFor="role">
                  <Select id="role" name="role" defaultValue="owner">
                    <option value="owner">{CONTRACT_ROLE.owner}</option>
                    <option value="tenant">{CONTRACT_ROLE.tenant}</option>
                  </Select>
                </Field>
                <Field label="Alkaa" htmlFor="startsOn">
                  <Input id="startsOn" name="startsOn" type="date" defaultValue={today} required />
                </Field>
                <div className="flex flex-col justify-end gap-2 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="billed" defaultChecked className="size-4" /> Laskutetaan tältä asiakkaalta
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="endPrevious" defaultChecked className="size-4" /> Päätä edellinen maksaja edelliseen päivään
                  </label>
                </div>
                <div className="sm:col-span-2">
                  <Button>Tallenna sopimus</Button>
                </div>
              </form>
            )}
          </Disclosure>
        ) : null}
      </section>

      {/* Liittymät */}
      <section className="mt-10">
        <SectionTitle>Liittymät</SectionTitle>
        {connections.length === 0 ? (
          <EmptyState title="Ei liittymiä" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Laji</Th>
                <Th>Liitetty</Th>
                <Th>Päättynyt</Th>
                {canEdit ? <Th /> : null}
              </tr>
            </thead>
            <tbody>
              {connections.map((c) => (
                <tr key={c.id} className={c.disconnected_on ? "text-ink/50" : undefined}>
                  <Td className="font-semibold">{CONNECTION_KIND[c.kind]}</Td>
                  <Td className="tabular">{formatDate(c.connected_on)}</Td>
                  <Td className="tabular">{c.disconnected_on ? formatDate(c.disconnected_on) : "–"}</Td>
                  {canEdit ? (
                    <Td className="text-right">
                      {!c.disconnected_on ? (
                        <form action={disconnectAction} className="inline-flex items-center gap-2">
                          <input type="hidden" name="connectionId" value={c.id} />
                          <input type="hidden" name="propertyId" value={id} />
                          <label htmlFor={`disc-${c.id}`} className="sr-only">
                            Päättymispäivä
                          </label>
                          <input id={`disc-${c.id}`} name="disconnectedOn" type="date" required className="rounded-lg border border-line px-2 py-1 text-sm" />
                          <button className="text-sm font-semibold text-sky">Päätä</button>
                        </form>
                      ) : null}
                    </Td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {canEdit && activeConnections.length < 2 ? (
          <Disclosure label="Lisää liittymä">
            <form action={addConnectionAction} className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
              <input type="hidden" name="propertyId" value={id} />
              <Field label="Laji" htmlFor="kind">
                <Select id="kind" name="kind">
                  {(["water", "wastewater"] as const)
                    .filter((k) => !activeConnections.some((c) => c.kind === k))
                    .map((k) => (
                      <option key={k} value={k}>
                        {CONNECTION_KIND[k]}
                      </option>
                    ))}
                </Select>
              </Field>
              <Field label="Liitetty" htmlFor="connectedOn">
                <Input id="connectedOn" name="connectedOn" type="date" required />
              </Field>
              <Button>Lisää</Button>
            </form>
          </Disclosure>
        ) : null}
      </section>

      <section className="mt-10">
        <SectionTitle>Lukemahistoria</SectionTitle>
        {readings.length === 0 ? (
          <EmptyState title="Ei lukemia" />
        ) : (
          <ReadingsTable rows={readings} canReview={canEdit} backTo={back} showProperty={false} />
        )}
      </section>

      {p.legacy_id ? <p className="mt-8 text-xs text-ink/45">Tunniste mittarilukema.fi:ssä: {p.legacy_id}</p> : null}
    </>
  );
}
