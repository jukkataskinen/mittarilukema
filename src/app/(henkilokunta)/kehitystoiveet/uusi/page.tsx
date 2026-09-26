import { Button, Field, Input, PageHeader, Panel, Select, Textarea } from "@/components/ui";
import { FormError } from "@/components/FormError";
import { requireStaff } from "@/lib/auth/current-user";
import { featureOptions, IMPORTANCE_LABEL } from "@/lib/feature-requests";
import { createFeatureRequestAction } from "../actions";

export const metadata = { title: "Uusi kehitystoive" };

export default async function NewFeatureRequestPage({ searchParams }: { searchParams: Promise<{ toiminto?: string; sivu?: string; virhe?: string }> }) {
  const sp = await searchParams;
  await requireStaff();
  const options = featureOptions();
  const feature = options.some((f) => f.value === sp.toiminto) ? sp.toiminto : "";
  const groups = [...new Set(options.map((o) => o.group))];
  const page = sp.sivu && /^\/[\w\-/]*$/.test(sp.sivu) ? sp.sivu : "";

  return (
    <div className="max-w-2xl">
      <PageHeader title="Uusi kehitystoive" back={{ href: "/kehitystoiveet", label: "Kehitystoiveet" }} />
      <FormError message={sp.virhe} />
      <Panel>
        <form action={createFeatureRequestAction} className="grid gap-5">
          <input type="hidden" name="pagePath" value={page} />
          <Field label="Mitä toimintoa toive koskee?" htmlFor="feature" hint="Valitse lähin. Jos kyse on kokonaan uudesta asiasta, valitse Uusi toiminto tai muu asia.">
            <Select id="feature" name="feature" defaultValue={feature} required>
              <option value="" disabled>
                Valitse toiminto
              </option>
              {groups.map((g) => (
                <optgroup key={g} label={g}>
                  {options
                    .filter((o) => o.group === g)
                    .map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                </optgroup>
              ))}
            </Select>
          </Field>
          <Field label="Otsikko" htmlFor="title" hint="Lyhyesti, esimerkiksi: Lukemat Excel-tiedostona.">
            <Input id="title" name="title" required maxLength={200} />
          </Field>
          <Field label="Mitä toivot ja miksi?" htmlFor="description" hint="Kerro, mitä yrität tehdä ja mikä nyt on hankalaa. Älä kirjoita asiakkaiden henkilötietoja.">
            <Textarea id="description" name="description" rows={7} required maxLength={5000} />
          </Field>
          <Field label="Kuinka tärkeä?" htmlFor="importance">
            <Select id="importance" name="importance" defaultValue="nice">
              {Object.entries(IMPORTANCE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <div>
            <Button>Lähetä toive</Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
