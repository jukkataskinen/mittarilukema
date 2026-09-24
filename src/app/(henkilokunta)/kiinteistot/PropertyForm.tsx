import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { BILLING_METHOD } from "@/lib/labels";
import type { AreaRow, PropertyDetail } from "@/lib/registry/queries";

/** Kiinteistön perustiedot: sama lomake uudelle ja muokkaukselle. */
export function PropertyForm({
  action,
  areas,
  property,
  orgBillingMethod,
  submitLabel,
}: {
  action: (formData: FormData) => Promise<void>;
  areas: AreaRow[];
  property?: PropertyDetail;
  orgBillingMethod: string;
  submitLabel: string;
}) {
  return (
    <form action={action} className="grid gap-5">
      {property ? <input type="hidden" name="propertyId" value={property.id} /> : null}
      <Field label="Katuosoite" htmlFor="streetAddress">
        <Input id="streetAddress" name="streetAddress" defaultValue={property?.street_address} required autoComplete="off" />
      </Field>
      <div className="grid gap-5 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <Field label="Postinumero" htmlFor="postalCode">
          <Input id="postalCode" name="postalCode" inputMode="numeric" defaultValue={property?.postal_code ?? ""} />
        </Field>
        <Field label="Postitoimipaikka" htmlFor="city">
          <Input id="city" name="city" defaultValue={property?.city ?? ""} />
        </Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Alue" htmlFor="areaId" hint="Perusmaksu voi olla aluekohtainen. Alueet lisätään asetuksissa.">
          <Select id="areaId" name="areaId" defaultValue={property?.area_id ?? ""}>
            <option value="">Ei aluetta</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Kiinteistötunnus" htmlFor="propertyCode">
          <Input id="propertyCode" name="propertyCode" placeholder="172-402-4-543" defaultValue={property?.property_code ?? ""} />
        </Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Laskutustapa" htmlFor="billingMethod" hint={`Oletus on organisaation asetus: ${BILLING_METHOD[orgBillingMethod].toLowerCase()}.`}>
          <Select id="billingMethod" name="billingMethod" defaultValue={property?.billing_method ?? ""}>
            <option value="">Organisaation oletus</option>
            <option value="actual">{BILLING_METHOD.actual}</option>
            <option value="estimate">{BILLING_METHOD.estimate}</option>
          </Select>
        </Field>
        <Field label="Arvioitu vuosikulutus (m³)" htmlFor="estimatedAnnualM3" hint="Vain uudelle liittymälle, jolla ei ole edellisen vuoden kulutusta.">
          <Input id="estimatedAnnualM3" name="estimatedAnnualM3" inputMode="decimal" defaultValue={property?.estimated_annual_m3?.replace(".", ",") ?? ""} />
        </Field>
      </div>
      <Field label="Muistiinpanot" htmlFor="notes">
        <Textarea id="notes" name="notes" defaultValue={property?.notes ?? ""} />
      </Field>
      <div>
        <Button>{submitLabel}</Button>
      </div>
    </form>
  );
}
