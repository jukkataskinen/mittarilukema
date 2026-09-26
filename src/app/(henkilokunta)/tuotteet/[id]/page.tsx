import { notFound } from "next/navigation";
import { Button, Field, Input, PageHeader, Panel, SectionTitle, Select, Textarea } from "@/components/ui";
import { FormError } from "@/components/FormError";
import { requireRole } from "@/lib/auth/current-user";
import { MATCH_LABEL } from "@/lib/products";
import { saveProductAction } from "../actions";

export const metadata = { title: "Tuote" };

const FEE_CLASSES = ["okt", "dn20", "dn25", "dn32", "dn40", "dn50", "dn65"];

export default async function ProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ virhe?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const isNew = id === "uusi";
  if (!isNew && !/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireRole("owner", "staff");
  const orgId = ctx.org.organizationId;
  const data = await ctx.run(async (tx) => {
    const [p] = isNew
      ? [null]
      : await tx.query<{
          code: string; name: string; unit: string | null; default_price_eur: string | null; vat_percent: string | null; account_id: string | null;
          cost_center_id: string | null; active: boolean; auto_match: boolean; match_charge_type: string | null; match_connection_kind: string | null;
          match_fee_class: string | null; match_area_id: string | null; match_customer_group: string | null; match_metered: boolean | null; notes: string | null;
        }>(
          `select code, name, unit, default_price_eur::text, vat_percent::text, account_id, cost_center_id, active, auto_match, match_charge_type,
                  match_connection_kind, match_fee_class, match_area_id, match_customer_group, match_metered, notes
             from ml_products where organization_id = $1 and id = $2`,
          [orgId, id],
        );
    return {
      p,
      accounts: await tx.query<{ id: string; code: string; name: string | null }>("select id, code, name from ml_accounts where organization_id = $1 order by code", [orgId]),
      costCenters: await tx.query<{ id: string; code: string; name: string }>(
        "select id, code, name from ml_cost_centers where organization_id = $1 and active order by code",
        [orgId],
      ),
      areas: await tx.query<{ id: string; name: string }>("select id, name from ml_areas where organization_id = $1 order by name", [orgId]),
      groups: (
        await tx.query<{ g: string }>(
          "select distinct customer_group as g from ml_customers where organization_id = $1 and customer_group is not null order by 1",
          [orgId],
        )
      ).map((r) => r.g),
    };
  });
  const p = data.p;
  if (!isNew && !p) notFound();
  const n = (v: string | null | undefined) => (v ? String(Number(v)).replace(".", ",") : "");

  return (
    <div className="max-w-3xl">
      <PageHeader title={isNew ? "Uusi tuote" : `${p!.code} ${p!.name}`} back={{ href: "/tuotteet", label: "Tuotteet ja tilit" }} />
      <FormError message={sp.virhe} />
      <form action={saveProductAction} className="grid gap-8">
        {!isNew ? <input type="hidden" name="productId" value={id} /> : null}
        <Panel>
          <SectionTitle>Tuote</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
            <Field label="Koodi" htmlFor="code" hint="Sama kuin Fennoassa.">
              <Input id="code" name="code" defaultValue={p?.code} required maxLength={40} />
            </Field>
            <Field label="Nimi" htmlFor="name">
              <Input id="name" name="name" defaultValue={p?.name} required maxLength={200} />
            </Field>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Field label="Oletushinta (€, alv 0 %)" htmlFor="defaultPrice" hint="Tieto. Laskut lasketaan hinnaston hinnoilla.">
              <Input id="defaultPrice" name="defaultPrice" inputMode="decimal" defaultValue={n(p?.default_price_eur)} />
            </Field>
            <Field label="Yksikkö" htmlFor="unit">
              <Input id="unit" name="unit" defaultValue={p?.unit ?? ""} maxLength={20} />
            </Field>
            <Field label="Alv %" htmlFor="vatPercent" hint="Tyhjä: ei arvonlisäveroa.">
              <Input id="vatPercent" name="vatPercent" inputMode="decimal" defaultValue={n(p?.vat_percent)} />
            </Field>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Kirjanpidon tili" htmlFor="accountId">
              <Select id="accountId" name="accountId" defaultValue={p?.account_id ?? ""}>
                <option value="">Ei tiliä</option>
                {data.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code}
                    {a.name ? ` ${a.name}` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Laskentakohde" htmlFor="costCenterId">
              <Select id="costCenterId" name="costCenterId" defaultValue={p?.cost_center_id ?? ""}>
                <option value="">Ei laskentakohdetta</option>
                {data.costCenters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <label className="mt-4 flex items-center gap-2 text-sm">
            <input type="checkbox" name="active" defaultChecked={p?.active ?? true} className="size-4" /> Käytössä
          </label>
        </Panel>

        <Panel>
          <SectionTitle>Milloin tuote valitaan laskulle</SectionTitle>
          <p className="mb-4 text-sm text-ink/70">
            Laskutusajo valitsee jokaiselle laskuriville tuotteen, jonka ehdoista mahdollisimman moni sopii. Tyhjä ehto sopii kaikkiin. Esimerkiksi kunnan
            tuote voittaa tavallisen tuotteen, kun asiakas kuuluu ryhmään kunta.
          </p>
          <label className="mb-4 flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" name="autoMatch" defaultChecked={p?.auto_match ?? false} className="size-4" /> Valitaan laskuille automaattisesti
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Maksulaji" htmlFor="matchChargeType">
              <Select id="matchChargeType" name="matchChargeType" defaultValue={p?.match_charge_type ?? ""}>
                <option value="">Mikä tahansa</option>
                {Object.entries(MATCH_LABEL.chargeType).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Liittymä" htmlFor="matchConnectionKind">
              <Select id="matchConnectionKind" name="matchConnectionKind" defaultValue={p?.match_connection_kind ?? ""}>
                <option value="">Kumpi tahansa</option>
                <option value="water">Vesi</option>
                <option value="wastewater">Jätevesi</option>
              </Select>
            </Field>
            <Field label="Perusmaksuluokka" htmlFor="matchFeeClass">
              <Select id="matchFeeClass" name="matchFeeClass" defaultValue={p?.match_fee_class ?? ""}>
                <option value="">Mikä tahansa</option>
                {FEE_CLASSES.map((c) => (
                  <option key={c} value={c}>
                    {c === "okt" ? "Omakotitalo" : c.toUpperCase()}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Alue" htmlFor="matchAreaId">
              <Select id="matchAreaId" name="matchAreaId" defaultValue={p?.match_area_id ?? ""}>
                <option value="">Mikä tahansa</option>
                {data.areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Asiakasryhmä" htmlFor="matchCustomerGroup" hint="Asiakkaalle ryhmä asetetaan asiakkaan tiedoissa.">
              <Input id="matchCustomerGroup" name="matchCustomerGroup" list="groups" defaultValue={p?.match_customer_group ?? ""} maxLength={40} />
              <datalist id="groups">
                {data.groups.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </Field>
            <Field label="Mittari" htmlFor="matchMetered">
              <Select id="matchMetered" name="matchMetered" defaultValue={p?.match_metered === true ? "yes" : p?.match_metered === false ? "no" : ""}>
                <option value="">Ei väliä</option>
                <option value="yes">Kiinteistöllä on mittari</option>
                <option value="no">Kiinteistöllä ei ole mittaria</option>
              </Select>
            </Field>
          </div>
        </Panel>

        <Panel>
          <Field label="Muistiinpano" htmlFor="notes">
            <Textarea id="notes" name="notes" rows={2} defaultValue={p?.notes ?? ""} maxLength={2000} />
          </Field>
        </Panel>
        <div>
          <Button>Tallenna tuote</Button>
        </div>
      </form>
    </div>
  );
}
