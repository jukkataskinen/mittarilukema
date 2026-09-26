import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, DefinitionList, Field, LinkButton, Notice, PageHeader, Panel, SectionTitle, Select, Textarea } from "@/components/ui";
import { FormError } from "@/components/FormError";
import { requireRole } from "@/lib/auth/current-user";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { formatPhone } from "@/lib/validation/phone";
import { getChangeRequest, KIND_LABEL, LOAN_LABEL, REQUEST_STATUS, ROLE_LABEL } from "@/lib/change-requests";
import { closeRequestAction, linkPropertyAction } from "../actions";

export const metadata = { title: "Muutosilmoitus" };

export default async function ChangeRequestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ virhe?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireRole("owner", "staff");
  const orgId = ctx.org.organizationId;
  const data = await ctx.run(async (tx) => {
    const r = await getChangeRequest(tx, orgId, id);
    if (!r) return null;
    // Ehdotus: käyttöpaikka, jonka osoite on sama kuin ilmoituksessa ennen ensimmäistä pilkkua (esim. "Kuusitie 4, Joutsa").
    const street = r.place_text.split(",")[0].trim().toLowerCase();
    const properties = await tx.query<{ id: string; street_address: string; city: string | null; legacy_id: string | null; suggested: boolean }>(
      `select id, street_address, city, legacy_id,
              ($2 <> '' and (lower(street_address) = $2 or lower(street_address) like $2 || ' %')) as suggested
         from ml_properties where organization_id = $1 order by suggested desc, lower(street_address)`,
      [orgId, street],
    );
    return { r, properties };
  });
  if (!data) notFound();
  const { r, properties } = data;
  const st = REQUEST_STATUS[r.status];
  const open = r.status === "new" || r.status === "in_progress";
  const suggestions = properties.filter((p) => p.suggested);

  const flow =
    r.property_id && (r.kind === "sale" || r.kind === "move_in" || r.kind === "move_out")
      ? {
          href: `/kiinteistot/${r.property_id}/${r.kind === "sale" ? "omistajanvaihdos" : "vuokralainen"}?ilmoitus=${r.id}`,
          label: r.kind === "sale" ? "Kirjaa omistajanvaihdos" : "Kirjaa vuokralaisen vaihdos",
        }
      : null;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={KIND_LABEL[r.kind]}
        subtitle={`Saapui ${formatDateTime(r.created_at)}`}
        back={{ href: "/muutosilmoitukset", label: "Muutosilmoitukset" }}
        actions={<Badge tone={st.tone}>{st.label}</Badge>}
      />
      <FormError message={sp.virhe} />

      <Panel>
        <DefinitionList
          items={[
            { label: "Käyttöpaikka ilmoituksessa", value: r.place_text },
            ...(r.change_date ? [{ label: r.kind === "sale" ? "Luovutuspäivä" : "Muuttopäivä", value: formatDate(r.change_date) }] : []),
            { label: "Ilmoittaja", value: [r.submitter_name, r.submitter_role ? `(${ROLE_LABEL[r.submitter_role]?.toLowerCase()})` : ""].join(" ") },
            { label: "Ilmoittajan yhteystiedot", value: [r.submitter_email, r.submitter_phone ? formatPhone(r.submitter_phone) : null].filter(Boolean).join(", ") || null },
            ...(r.party_name || r.party_email || r.party_phone || r.party_address
              ? [
                  { label: r.kind === "sale" ? "Ostaja" : r.kind === "move_in" ? "Vuokralainen" : "Uudet tiedot", value: r.party_name },
                  {
                    label: "Yhteystiedot ja osoite",
                    value: [r.party_email, r.party_phone ? formatPhone(r.party_phone) : null, r.party_address].filter(Boolean).join(", ") || null,
                  },
                ]
              : []),
            ...(r.other_name ? [{ label: r.kind === "sale" ? "Myyjä" : "Omistaja", value: r.other_name }] : []),
            ...(r.loan_answer ? [{ label: "Laina", value: LOAN_LABEL[r.loan_answer] }] : []),
            ...(r.reading ? [{ label: "Lukema", value: `${formatNumber(r.reading, "m³")}${r.meter_number ? `, mittari ${r.meter_number}` : ""}` }] : []),
            ...(r.message ? [{ label: "Viesti", value: <span className="whitespace-pre-line">{r.message}</span> }] : []),
          ]}
        />
      </Panel>

      <section className="mt-8">
        <SectionTitle>Käsittely</SectionTitle>
        <Panel>
          <p className="text-sm font-semibold">1. Kohdista käyttöpaikkaan</p>
          {r.property_id ? (
            <p className="mt-2 text-sm">
              <Link href={`/kiinteistot/${r.property_id}`} className="font-semibold text-sky hover:underline">
                {r.street_address}
              </Link>
            </p>
          ) : suggestions.length ? (
            <p className="mt-2 text-sm text-ink/65">Ehdotus osoitteen perusteella on listan alussa.</p>
          ) : (
            <p className="mt-2 text-sm text-amber">Osoitteella ei löytynyt suoraa osumaa. Valitse käyttöpaikka listasta.</p>
          )}
          {open ? (
            <form action={linkPropertyAction} className="mt-3 flex flex-wrap items-end gap-3">
              <input type="hidden" name="requestId" value={r.id} />
              <div className="min-w-64 flex-1">
                <Field label="Käyttöpaikka" htmlFor="propertyId">
                  <Select id="propertyId" name="propertyId" defaultValue={r.property_id ?? suggestions[0]?.id ?? ""}>
                    <option value="">Valitse</option>
                    {properties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.street_address}
                        {p.city ? `, ${p.city}` : ""}
                        {p.legacy_id ? ` (${p.legacy_id})` : ""}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Button variant="secondary">{r.property_id ? "Vaihda" : "Kohdista"}</Button>
            </form>
          ) : null}

          <p className="mt-6 text-sm font-semibold">2. Kirjaa muutos</p>
          {!open ? (
            <p className="mt-2 text-sm text-ink/65">
              {r.status === "done" ? "Ilmoitus on käsitelty" : "Ilmoitus on hylätty"}
              {r.handled_at ? ` ${formatDateTime(r.handled_at)}` : ""}.{r.handled_note ? ` ${r.handled_note}` : ""}
            </p>
          ) : flow ? (
            <div className="mt-2">
              <LinkButton href={flow.href}>{flow.label}</LinkButton>
              <p className="mt-2 text-xs text-ink/55">Lomake täytetään ilmoituksen tiedoilla. Tarkista ne ja kirjaa; ilmoitus merkitään silloin käsitellyksi.</p>
            </div>
          ) : r.kind === "billing" || r.kind === "other" ? (
            <p className="mt-2 text-sm text-ink/65">Päivitä asiakkaan tiedot asiakasrekisterissä ja merkitse ilmoitus käsitellyksi.</p>
          ) : (
            <p className="mt-2 text-sm text-ink/65">Kohdista ilmoitus ensin käyttöpaikkaan.</p>
          )}

          {open ? (
            <form action={closeRequestAction} className="mt-6 grid gap-3 border-t border-line pt-4">
              <input type="hidden" name="requestId" value={r.id} />
              <Field label="Muistiinpano" htmlFor="note" hint="Hylkäyksessä pakollinen.">
                <Textarea id="note" name="note" rows={2} maxLength={2000} />
              </Field>
              <div className="flex flex-wrap gap-3">
                <Button name="status" value="done" variant="secondary">
                  Merkitse käsitellyksi
                </Button>
                <Button name="status" value="rejected" variant="secondary">
                  Hylkää
                </Button>
              </div>
            </form>
          ) : (
            <form action={closeRequestAction} className="mt-4">
              <input type="hidden" name="requestId" value={r.id} />
              <Button name="status" value="in_progress" variant="secondary">
                Avaa uudelleen
              </Button>
            </form>
          )}
        </Panel>
        {r.event_id && r.property_id ? (
          <div className="mt-4">
            <Notice tone="ok" title="Muutos kirjattu käyttöpaikan tapahtumaksi.">
              <Link href={`/kiinteistot/${r.property_id}/aikajana`} className="font-semibold text-sky">
                Avaa aikajana
              </Link>
            </Notice>
          </div>
        ) : null}
      </section>
    </div>
  );
}
