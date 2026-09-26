import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "@/components/Brand";
import { Button, Field, Input, Notice, Panel, Select, Textarea } from "@/components/ui";
import { getDb } from "@/lib/db";
import { isoDateHelsinki } from "@/lib/format";
import { formatPhone } from "@/lib/validation/phone";
import { CHANGE_KINDS, KIND_LABEL, KIND_SLUG, orgByFormToken, type ChangeKind } from "@/lib/change-requests";
import { submitChangeRequestAction } from "./actions";

export const metadata = { title: "Muutosilmoitus", robots: { index: false } };
export const dynamic = "force-dynamic";

const KIND_HINT: Record<ChangeKind, string> = {
  sale: "Myyjä tai ostaja ilmoittaa kaupasta. Tarvitsemme luovutuspäivän, ostajan tiedot ja mittarilukeman luovutuspäivältä.",
  move_in: "Omistaja tai vuokralainen ilmoittaa, että kiinteistöön muuttaa vuokralainen, joka maksaa vesilaskun.",
  move_out: "Vuokralainen muuttaa pois. Tarvitsemme muuttopäivän lukeman ja osoitteen loppulaskua varten.",
  billing: "Laskutusosoite, sähköpostiosoite tai puhelinnumero muuttuu.",
  other: "Muu vesihuoltoon tai laskutukseen liittyvä asia.",
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="grid gap-4">
      <legend className="mb-1 text-lg font-bold">{title}</legend>
      {children}
    </fieldset>
  );
}

/**
 * Julkinen muutosilmoitus (QR-koodi laskussa tai tiedotteessa). Lomake ei
 * näytä rekisteristä mitään: ilmoitus menee toimistolle, joka kohdistaa sen.
 */
export default async function ChangeRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ laji?: string; virhe?: string; kiitos?: string }>;
}) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const org = await orgByFormToken(await getDb(), token);
  const kind = CHANGE_KINDS.find((k) => KIND_SLUG[k] === sp.laji) ?? null;
  const today = isoDateHelsinki();

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-5 py-10">
      <Brand size={26} />
      {!org ? (
        <div className="mt-10">
          <h1 className="text-2xl">Lomaketta ei löytynyt</h1>
          <p className="mt-3 text-ink/70">Tarkista osoite tai ota yhteyttä vesihuoltolaitokseen.</p>
        </div>
      ) : sp.kiitos ? (
        <div className="mt-10">
          <p className="text-sm font-semibold text-ink/60">{org.name}</p>
          <h1 className="mt-1 text-2xl">Kiitos, ilmoitus on vastaanotettu</h1>
          <p className="mt-3 text-ink/70">Käsittelemme ilmoituksen ja otamme tarvittaessa yhteyttä. Sinun ei tarvitse tehdä muuta.</p>
          <Link href={`/ilmoitus/${token}`} className="mt-6 inline-block text-sm font-semibold text-sky">
            Tee toinen ilmoitus
          </Link>
        </div>
      ) : !kind ? (
        <div className="mt-8">
          <p className="text-sm font-semibold text-ink/60">{org.name}</p>
          <h1 className="mt-1 text-2xl">Ilmoita muutoksesta</h1>
          <p className="mt-3 text-ink/70">Valitse, mistä haluat ilmoittaa.</p>
          <div className="mt-6 grid gap-3">
            {CHANGE_KINDS.map((k) => (
              <Link key={k} href={`/ilmoitus/${token}?laji=${KIND_SLUG[k]}`} className="rounded-[var(--radius-panel)] border border-line bg-paper p-4 hover:border-ink/25">
                <span className="font-bold">{KIND_LABEL[k]}</span>
                <span className="mt-1 block text-sm text-ink/65">{KIND_HINT[k]}</span>
              </Link>
            ))}
          </div>
          {org.contact_phone || org.contact_email ? (
            <p className="mt-8 text-sm text-ink/60">
              Voit ottaa yhteyttä myös {org.contact_phone ? `puhelimitse ${formatPhone(org.contact_phone)}` : ""}
              {org.contact_phone && org.contact_email ? " tai " : ""}
              {org.contact_email ? `sähköpostilla ${org.contact_email}` : ""}.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="mt-8">
          <Link href={`/ilmoitus/${token}`} className="text-sm font-semibold text-sky">
            ← Valitse toinen ilmoitus
          </Link>
          <p className="mt-4 text-sm font-semibold text-ink/60">{org.name}</p>
          <h1 className="mt-1 text-2xl">{KIND_LABEL[kind]}</h1>
          <p className="mt-2 text-ink/70">{KIND_HINT[kind]}</p>
          {sp.virhe ? (
            <div className="mt-5">
              <Notice tone="alert" title={sp.virhe} />
            </div>
          ) : null}
          <Panel className="mt-6">
            <form action={submitChangeRequestAction} className="grid gap-8">
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="kind" value={kind} />
              {/* Ansakenttä roboteille: piilotettu ihmisiltä ja ruudunlukijoilta. */}
              <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
                <label>
                  Verkkosivu <input name="website" tabIndex={-1} autoComplete="off" />
                </label>
              </div>

              <Section title="Käyttöpaikka">
                <Field label="Kiinteistön osoite" htmlFor="placeText" hint="Katuosoite ja paikkakunta. Jos laskussa on käyttöpaikan tunnus, voit lisätä sen.">
                  <Input id="placeText" name="placeText" required maxLength={200} autoComplete="street-address" />
                </Field>
                {kind === "sale" || kind === "move_in" || kind === "move_out" ? (
                  <Field label={kind === "sale" ? "Luovutuspäivä" : "Muuttopäivä"} htmlFor="changeDate">
                    <Input id="changeDate" name="changeDate" type="date" defaultValue={today} required />
                  </Field>
                ) : null}
              </Section>

              <Section title="Sinun tietosi">
                <Field label="Nimi" htmlFor="submitterName">
                  <Input id="submitterName" name="submitterName" required maxLength={200} autoComplete="name" />
                </Field>
                {kind === "sale" || kind === "move_in" ? (
                  <Field label="Olen" htmlFor="submitterRole">
                    <Select id="submitterRole" name="submitterRole" defaultValue={kind === "sale" ? "seller" : "owner"}>
                      {kind === "sale" ? (
                        <>
                          <option value="seller">Myyjä</option>
                          <option value="buyer">Ostaja</option>
                        </>
                      ) : (
                        <>
                          <option value="owner">Omistaja</option>
                          <option value="tenant">Vuokralainen</option>
                        </>
                      )}
                      <option value="other">Muu, esimerkiksi välittäjä</option>
                    </Select>
                  </Field>
                ) : (
                  <input type="hidden" name="submitterRole" value={kind === "move_out" ? "tenant" : "owner"} />
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Sähköposti" htmlFor="submitterEmail">
                    <Input id="submitterEmail" name="submitterEmail" type="email" maxLength={200} autoComplete="email" />
                  </Field>
                  <Field label="Puhelin" htmlFor="submitterPhone">
                    <Input id="submitterPhone" name="submitterPhone" type="tel" maxLength={40} autoComplete="tel" />
                  </Field>
                </div>
              </Section>

              {kind === "sale" || kind === "move_in" ? (
                <Section title={kind === "sale" ? "Ostaja" : "Vuokralainen"}>
                  <Field label="Nimi" htmlFor="partyName" hint={kind === "sale" ? "Kaikki ostajat, jos heitä on useampi." : undefined}>
                    <Input id="partyName" name="partyName" required maxLength={200} />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Sähköposti" htmlFor="partyEmail">
                      <Input id="partyEmail" name="partyEmail" type="email" maxLength={200} />
                    </Field>
                    <Field label="Puhelin" htmlFor="partyPhone">
                      <Input id="partyPhone" name="partyPhone" type="tel" maxLength={40} />
                    </Field>
                  </div>
                  <Field label="Laskutusosoite" htmlFor="partyAddress" hint="Jos eri kuin kiinteistön osoite.">
                    <Input id="partyAddress" name="partyAddress" maxLength={300} />
                  </Field>
                  {kind === "sale" ? (
                    <Field label="Myyjän nimi" htmlFor="otherName" hint="Jos ilmoitat ostajana.">
                      <Input id="otherName" name="otherName" maxLength={200} />
                    </Field>
                  ) : (
                    <Field label="Omistajan nimi" htmlFor="otherName" hint="Jos ilmoitat vuokralaisena.">
                      <Input id="otherName" name="otherName" maxLength={200} />
                    </Field>
                  )}
                </Section>
              ) : null}

              {kind === "sale" ? (
                <Section title="Liittymän laina">
                  <p className="-mt-2 text-sm text-ink/65">
                    Jos kiinteistöön kohdistuu vesiosuuskunnan tai laitoksen laina, se laskutetaan myyjältä, kunnes kauppakirja osoittaa sen siirtyneen
                    ostajalle. Voit lähettää kauppakirjan kohdan erikseen sähköpostilla.
                  </p>
                  <div className="grid gap-2 text-sm">
                    {[
                      ["transfers", "Laina siirtyy kauppakirjan mukaan ostajalle"],
                      ["stays", "Laina jää myyjälle"],
                      ["unknown", "En tiedä tai kiinteistöllä ei ole lainaa"],
                    ].map(([v, l]) => (
                      <label key={v} className="flex items-center gap-2">
                        <input type="radio" name="loanAnswer" value={v} defaultChecked={v === "unknown"} className="size-4" /> {l}
                      </label>
                    ))}
                  </div>
                </Section>
              ) : null}

              {kind === "move_out" || kind === "billing" ? (
                <Section title={kind === "move_out" ? "Loppulasku" : "Uudet tiedot"}>
                  <Field label={kind === "move_out" ? "Uusi osoite loppulaskua varten" : "Uusi laskutusosoite"} htmlFor="partyAddress">
                    <Input id="partyAddress" name="partyAddress" maxLength={300} />
                  </Field>
                  {kind === "billing" ? (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Uusi sähköposti" htmlFor="partyEmail">
                        <Input id="partyEmail" name="partyEmail" type="email" maxLength={200} />
                      </Field>
                      <Field label="Uusi puhelin" htmlFor="partyPhone">
                        <Input id="partyPhone" name="partyPhone" type="tel" maxLength={40} />
                      </Field>
                    </div>
                  ) : null}
                </Section>
              ) : null}

              {kind === "sale" || kind === "move_in" || kind === "move_out" ? (
                <Section title="Mittarilukema">
                  <p className="-mt-2 text-sm text-ink/65">
                    Lue vesimittarin lukema {kind === "sale" ? "luovutuspäivänä" : "muuttopäivänä"}. Sillä kulutus jaetaan oikein. Jos et saa lukemaa nyt, voit
                    ilmoittaa sen myöhemmin.
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Lukema (m³)" htmlFor="reading">
                      <Input id="reading" name="reading" inputMode="decimal" maxLength={20} />
                    </Field>
                    <Field label="Mittarin numero" htmlFor="meterNumber" hint="Jos näet sen mittarista.">
                      <Input id="meterNumber" name="meterNumber" maxLength={60} />
                    </Field>
                  </div>
                </Section>
              ) : null}

              <Field label={kind === "other" ? "Viesti" : "Lisätietoja"} htmlFor="message">
                <Textarea id="message" name="message" rows={4} maxLength={2000} required={kind === "other"} />
              </Field>

              <div>
                <p className="mb-3 text-xs text-ink/55">
                  Älä kirjoita lomakkeelle henkilötunnusta. Tietoja käytetään vain vesihuollon laskutukseen ja asiakassuhteen hoitamiseen.
                </p>
                <Button>Lähetä ilmoitus</Button>
              </div>
            </form>
          </Panel>
        </div>
      )}
    </div>
  );
}
