import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { CUSTOMER_KIND } from "@/lib/labels";
import { CHANNEL_LABEL, INVOICE_CHANNELS } from "@/lib/fennoa/channel";
import { formatPhone } from "@/lib/validation/phone";
import type { CustomerDetail } from "@/lib/registry/queries";

export function CustomerForm({
  action,
  customer,
  submitLabel,
}: {
  action: (formData: FormData) => Promise<void>;
  customer?: CustomerDetail;
  submitLabel: string;
}) {
  return (
    <form action={action} className="grid gap-5">
      {customer ? <input type="hidden" name="customerId" value={customer.id} /> : null}
      <div className="grid gap-5 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Field label="Nimi" htmlFor="name">
          <Input id="name" name="name" defaultValue={customer?.name} required autoComplete="off" />
        </Field>
        <Field label="Asiakasnumero" htmlFor="customerNumber">
          <Input id="customerNumber" name="customerNumber" defaultValue={customer?.customer_number ?? ""} autoComplete="off" />
        </Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Asiakastyyppi" htmlFor="kind">
          <Select id="kind" name="kind" defaultValue={customer?.kind ?? "person"}>
            <option value="person">{CUSTOMER_KIND.person}</option>
            <option value="company">{CUSTOMER_KIND.company}</option>
          </Select>
        </Field>
        <Field label="Y-tunnus" htmlFor="businessId" hint="Vain yritykselle tai yhteisölle.">
          <Input id="businessId" name="businessId" defaultValue={customer?.business_id ?? ""} />
        </Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Puhelin" htmlFor="phone" hint="Tekstiviestilukema yhdistetään asiakkaaseen tällä numerolla.">
          <Input id="phone" name="phone" type="tel" defaultValue={customer?.phone ? formatPhone(customer.phone) : ""} />
        </Field>
        <Field label="Sähköposti" htmlFor="email">
          <Input id="email" name="email" type="email" defaultValue={customer?.email ?? ""} />
        </Field>
      </div>
      <fieldset className="grid gap-5">
        <legend className="mb-1 text-sm font-semibold">Laskutusosoite</legend>
        <Field label="Katuosoite" htmlFor="billingStreet">
          <Input id="billingStreet" name="billingStreet" defaultValue={customer?.billing_street ?? ""} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-[10rem_minmax(0,1fr)]">
          <Field label="Postinumero" htmlFor="billingPostalCode">
            <Input id="billingPostalCode" name="billingPostalCode" inputMode="numeric" defaultValue={customer?.billing_postal_code ?? ""} />
          </Field>
          <Field label="Postitoimipaikka" htmlFor="billingCity">
            <Input id="billingCity" name="billingCity" defaultValue={customer?.billing_city ?? ""} />
          </Field>
        </div>
      </fieldset>
      <Field
        label="Laskukanava"
        htmlFor="invoiceChannel"
        hint="Miten lasku lähtee Fennoasta. Ilman kanavaa laskua ei viedä Fennoaan. Sähköpostilasku tarvitsee sähköpostiosoitteen, e-lasku ja suoramaksu tilinumeron ja pankin BIC-tunnuksen, verkkolasku OVT-tunnuksen ja välittäjän."
      >
        <Select id="invoiceChannel" name="invoiceChannel" defaultValue={customer?.invoice_channel ?? ""}>
          <option value="">Ei asetettu</option>
          {INVOICE_CHANNELS.map((c) => (
            <option key={c} value={c}>
              {CHANNEL_LABEL[c]}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Verkkolasku- tai e-laskuosoite" htmlFor="einvoiceAddress">
          <Input id="einvoiceAddress" name="einvoiceAddress" defaultValue={customer?.einvoice_address ?? ""} />
        </Field>
        <Field label="Välittäjä tai pankin BIC" htmlFor="einvoiceOperator">
          <Input id="einvoiceOperator" name="einvoiceOperator" defaultValue={customer?.einvoice_operator ?? ""} />
        </Field>
      </div>
      <Field
        label="Asiakasryhmä"
        htmlFor="customerGroup"
        hint="Vapaaehtoinen. Esimerkiksi kunta. Ryhmä valitsee laskulle ryhmän oman tuotteen ja kirjanpitotilin."
      >
        <Input id="customerGroup" name="customerGroup" defaultValue={customer?.customer_group ?? ""} maxLength={40} />
      </Field>
      <Field label="Muistiinpanot" htmlFor="notes">
        <Textarea id="notes" name="notes" defaultValue={customer?.notes ?? ""} />
      </Field>
      <div>
        <Button>{submitLabel}</Button>
      </div>
    </form>
  );
}
