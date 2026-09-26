import { Field, Input, Select } from "@/components/ui";
import { CONNECTION_KIND } from "@/lib/labels";
import { formatDate, formatNumber } from "@/lib/format";

/** Uusi osapuoli: rekisterin asiakas tai samalla perustettava uusi asiakas. */
export interface PartyPrefill {
  name: string | null;
  email: string | null;
  phone: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
}

export function PartyFields({
  label,
  customers,
  optional,
  prefill,
}: {
  label: string;
  customers: { id: string; name: string; customer_number: string | null }[];
  optional?: string;
  /** Muutosilmoituksen tiedot: uusi asiakas valmiiksi täytettynä. */
  prefill?: PartyPrefill | null;
}) {
  return (
    <div className="grid gap-4">
      <Field label={label} htmlFor="customerId" hint={prefill ? "Uuden asiakkaan tiedot tulevat ilmoituksesta. Jos asiakas on jo rekisterissä, valitse hänet." : undefined}>
        <Select id="customerId" name="customerId" required={!optional} defaultValue={prefill ? "new" : ""}>
          <option value="" disabled={!optional}>
            {optional ?? "Valitse asiakas"}
          </option>
          <option value="new">Uusi asiakas (täytä tiedot alle)</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.customer_number ? ` (${c.customer_number})` : ""}
            </option>
          ))}
        </Select>
      </Field>
      <fieldset className="grid gap-4 rounded-xl border border-line bg-cloud/40 p-4 sm:grid-cols-2">
        <legend className="px-1 text-sm font-semibold">Uusi asiakas</legend>
        <p className="text-xs text-ink/60 sm:col-span-2">
          Täytä vain, jos valitsit uuden asiakkaan. Laskukanavan voit asettaa asiakkaan sivulla; laskua ei viedä Fennoaan ennen sitä.
        </p>
        <Field label="Nimi" htmlFor="newName">
          <Input id="newName" name="newName" maxLength={200} defaultValue={prefill?.name ?? undefined} />
        </Field>
        <Field label="Asiakastyyppi" htmlFor="newKind">
          <Select id="newKind" name="newKind" defaultValue="person">
            <option value="person">Henkilö</option>
            <option value="company">Yritys tai yhteisö</option>
          </Select>
        </Field>
        <Field label="Sähköposti" htmlFor="newEmail">
          <Input id="newEmail" name="newEmail" type="email" maxLength={200} defaultValue={prefill?.email ?? undefined} />
        </Field>
        <Field label="Puhelin" htmlFor="newPhone">
          <Input id="newPhone" name="newPhone" maxLength={40} defaultValue={prefill?.phone ?? undefined} />
        </Field>
        <Field label="Laskutusosoite" htmlFor="newStreet">
          <Input id="newStreet" name="newStreet" maxLength={200} defaultValue={prefill?.street ?? undefined} />
        </Field>
        <div className="grid grid-cols-[8rem_1fr] gap-3">
          <Field label="Postinumero" htmlFor="newPostalCode">
            <Input id="newPostalCode" name="newPostalCode" inputMode="numeric" maxLength={5} defaultValue={prefill?.postalCode ?? undefined} />
          </Field>
          <Field label="Postitoimipaikka" htmlFor="newCity">
            <Input id="newCity" name="newCity" maxLength={100} defaultValue={prefill?.city ?? undefined} />
          </Field>
        </div>
      </fieldset>
    </div>
  );
}

/** Vaihtopäivän lukemat: pakolliset kaikille käytössä oleville mittareille. */
export function ReadingFields({
  meters,
  prefill,
}: {
  meters: { id: string; meter_number: string | null; kind: "water" | "wastewater"; last_reading: string | null; last_read_on: string | null }[];
  /** Asiakkaan ilmoittama lukema: täytetään, kun mittari on yksiselitteinen. */
  prefill?: { reading: string | null; meterNumber: string | null } | null;
}) {
  const norm = (n: string | null) => (n ?? "").replace(/\s/g, "").toUpperCase();
  const target =
    prefill?.reading == null
      ? null
      : (meters.find((m) => prefill.meterNumber && norm(m.meter_number) === norm(prefill.meterNumber)) ?? (meters.length === 1 ? meters[0] : null));
  if (meters.length === 0) return <p className="text-sm text-ink/60">Käyttöpaikalla ei ole käytössä olevia mittareita, joten lukemaa ei tarvita.</p>;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {meters.map((m) => (
        <Field
          key={m.id}
          label={`${m.meter_number ?? "Numeroton mittari"} (${CONNECTION_KIND[m.kind].toLowerCase()})`}
          htmlFor={`reading_${m.id}`}
          hint={m.last_reading ? `Edellinen ${formatNumber(m.last_reading)} (${formatDate(m.last_read_on!)})` : "Ei aiempaa lukemaa"}
        >
          <Input
            id={`reading_${m.id}`}
            name={`reading_${m.id}`}
            inputMode="decimal"
            required
            defaultValue={target?.id === m.id ? String(Number(prefill!.reading)).replace(".", ",") : undefined}
          />
        </Field>
      ))}
    </div>
  );
}
