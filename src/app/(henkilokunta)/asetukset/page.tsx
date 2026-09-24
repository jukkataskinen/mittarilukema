import { Button, Field, Input, Notice, PageHeader, Panel, SectionTitle, Select, Table, Td, Th } from "@/components/ui";
import { FormError } from "@/components/FormError";
import { requireRole, ROLE_LABEL, type OrgRole } from "@/lib/auth/current-user";
import { listAreas } from "@/lib/registry/queries";
import { BILLING_METHOD, MONTHS } from "@/lib/labels";
import { formatDateTime } from "@/lib/format";
import { addMemberAction, changeMemberRoleAction, createAreaAction, removeMemberAction, renameAreaAction, updateBillingAction } from "./actions";

export const metadata = { title: "Asetukset" };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ virhe?: string; ilmoitus?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireRole("owner");
  const orgId = ctx.org.organizationId;
  const data = await ctx.run(async (tx) => ({
    org: (
      await tx.query<{ name: string; business_id: string | null; billing_method: "actual" | "estimate"; billing_months: number[]; settlement_month: number | null }>(
        "select name, business_id, billing_method, billing_months, settlement_month from ml_organizations where id = $1",
        [orgId],
      )
    )[0],
    areas: await listAreas(tx, orgId),
    members: await tx.query<{ id: string; name: string; email: string; role: OrgRole; pending: boolean }>(
      `select u.id, coalesce(u.full_name, u.email) as name, u.email, m.role, u.auth_sub like 'pending|%' as pending
         from ml_org_members m join ml_users u on u.id = m.user_id
        where m.organization_id = $1 order by m.role, name`,
      [orgId],
    ),
    log: await tx.query<{ id: string; action: string; entity: string; created_at: string; user_name: string | null }>(
      `select l.id::text, l.action, l.entity, l.created_at, coalesce(u.full_name, u.email) as user_name
         from ml_audit_log l left join ml_users u on u.id = l.user_id
        where l.organization_id = $1 order by l.created_at desc limit 20`,
      [orgId],
    ),
  }));
  const { org } = data;

  return (
    <>
      <PageHeader title="Asetukset" subtitle={[org.name, org.business_id].filter(Boolean).join(" · ")} />
      <FormError message={sp.virhe} />
      {sp.ilmoitus === "tallennettu" ? (
        <div className="mb-5">
          <Notice tone="ok" title="Asetukset tallennettu." />
        </div>
      ) : null}
      {sp.ilmoitus === "kayttaja" ? (
        <div className="mb-5">
          <Notice tone="ok" title="Käyttäjä lisätty.">
            Kerro käyttäjälle osoite mittarilukema.vercel.app. Hän kirjautuu samalla sähköpostiosoitteella, jolla hänet lisättiin.
          </Notice>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <SectionTitle>Laskutus</SectionTitle>
          <Panel>
            <form action={updateBillingAction} className="grid gap-5">
              <Field label="Laskutustapa" htmlFor="billingMethod" hint="Oletus kaikille kiinteistöille. Kiinteistökohtainen poikkeus asetetaan kiinteistön tiedoissa.">
                <Select id="billingMethod" name="billingMethod" defaultValue={org.billing_method}>
                  <option value="actual">{BILLING_METHOD.actual}</option>
                  <option value="estimate">{BILLING_METHOD.estimate}</option>
                </Select>
              </Field>
              <fieldset>
                <legend className="text-sm font-semibold">Laskutuskuukaudet (toteutunut kulutus)</legend>
                <div className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                  {MONTHS.map((m, i) => (
                    <label key={m} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        name="billingMonths"
                        value={i + 1}
                        defaultChecked={org.billing_method === "actual" && org.billing_months.includes(i + 1)}
                        className="size-4"
                      />
                      {cap(m)}kuu
                    </label>
                  ))}
                </div>
              </fieldset>
              <Field label="Tasauslaskun kuukausi (arviolaskutus)" htmlFor="settlementMonth">
                <Select id="settlementMonth" name="settlementMonth" defaultValue={org.settlement_month ?? ""}>
                  <option value="">Ei valittu</option>
                  {MONTHS.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {cap(m)}kuu
                    </option>
                  ))}
                </Select>
              </Field>
              <div>
                <Button>Tallenna</Button>
              </div>
            </form>
          </Panel>
        </section>

        <section>
          <SectionTitle>Alueet</SectionTitle>
          <Panel>
            {data.areas.length === 0 ? <p className="mb-4 text-sm text-ink/65">Ei alueita. Perusmaksu voi olla aluekohtainen.</p> : null}
            <ul className="divide-y divide-line">
              {data.areas.map((a) => (
                <li key={a.id} className="py-2.5 first:pt-0">
                  <form action={renameAreaAction} className="flex items-center gap-3">
                    <input type="hidden" name="areaId" value={a.id} />
                    <label htmlFor={`area-${a.id}`} className="sr-only">
                      Alueen nimi
                    </label>
                    <Input id={`area-${a.id}`} name="name" defaultValue={a.name} className="min-h-10" />
                    <span className="whitespace-nowrap text-sm text-ink/55">{a.property_count} kiint.</span>
                    <button className="text-sm font-semibold text-sky">Tallenna</button>
                  </form>
                </li>
              ))}
            </ul>
            <form action={createAreaAction} className="mt-4 flex items-end gap-3 border-t border-line pt-4">
              <div className="flex-1">
                <Field label="Uusi alue" htmlFor="new-area">
                  <Input id="new-area" name="name" required />
                </Field>
              </div>
              <Button variant="secondary">Lisää</Button>
            </form>
          </Panel>
        </section>
      </div>

      <section className="mt-10">
        <SectionTitle>Käyttäjät</SectionTitle>
        <Table>
          <thead>
            <tr>
              <Th>Nimi</Th>
              <Th>Sähköposti</Th>
              <Th>Rooli</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {data.members.map((m) => (
              <tr key={m.id}>
                <Td className="font-semibold">
                  {m.name}
                  {m.pending ? <span className="block text-xs font-normal text-ink/55">Ei vielä kirjautunut</span> : null}
                </Td>
                <Td>{m.email}</Td>
                <Td>
                  {m.id === ctx.user.id ? (
                    ROLE_LABEL[m.role]
                  ) : (
                    <form action={changeMemberRoleAction} className="flex items-center gap-2">
                      <input type="hidden" name="userId" value={m.id} />
                      <label htmlFor={`role-${m.id}`} className="sr-only">
                        Rooli
                      </label>
                      <select id={`role-${m.id}`} name="role" defaultValue={m.role} className="rounded-lg border border-line bg-paper px-2 py-1 text-sm">
                        {(["owner", "staff", "reader"] as const).map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </option>
                        ))}
                      </select>
                      <button className="text-sm font-semibold text-sky">Tallenna</button>
                    </form>
                  )}
                </Td>
                <Td className="text-right">
                  {m.id !== ctx.user.id ? (
                    <form action={removeMemberAction}>
                      <input type="hidden" name="userId" value={m.id} />
                      <button className="text-sm font-semibold text-coral">Poista</button>
                    </form>
                  ) : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <Panel className="mt-4 max-w-3xl">
          <h3 className="font-semibold">Lisää käyttäjä</h3>
          <p className="mt-1 text-sm text-ink/65">
            Käyttäjä kirjautuu Auth0-tunnuksella. Jos hänellä ei vielä ole tunnusta, se luodaan Auth0:ssa samalla sähköpostiosoitteella.
          </p>
          <form action={addMemberAction} className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-end">
            <Field label="Sähköposti" htmlFor="member-email">
              <Input id="member-email" name="email" type="email" required autoComplete="off" />
            </Field>
            <Field label="Nimi" htmlFor="member-name">
              <Input id="member-name" name="fullName" autoComplete="off" />
            </Field>
            <Field label="Rooli" htmlFor="member-role">
              <Select id="member-role" name="role" defaultValue="staff">
                <option value="staff">{ROLE_LABEL.staff}</option>
                <option value="reader">{ROLE_LABEL.reader}</option>
                <option value="owner">{ROLE_LABEL.owner}</option>
              </Select>
            </Field>
            <Button>Lisää</Button>
          </form>
          <p className="mt-3 text-xs text-ink/55">
            Pääkäyttäjä: asetukset ja käyttäjät. Toimisto: rekisteri, hinnasto, lukemat ja laskutus. Mittarinlukija: näkee rekisterin ja kirjaa lukemia.
          </p>
        </Panel>
      </section>

      <section className="mt-10">
        <SectionTitle>Viimeisimmät tapahtumat</SectionTitle>
        {data.log.length === 0 ? (
          <p className="text-sm text-ink/65">Ei tapahtumia.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Aika</Th>
                <Th>Käyttäjä</Th>
                <Th>Tapahtuma</Th>
              </tr>
            </thead>
            <tbody>
              {data.log.map((l) => (
                <tr key={l.id}>
                  <Td className="tabular whitespace-nowrap">{formatDateTime(l.created_at)}</Td>
                  <Td>{l.user_name ?? "Järjestelmä"}</Td>
                  <Td className="font-mono text-xs">{l.action}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </>
  );
}
