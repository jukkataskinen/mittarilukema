import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { AUDIENCE_LABEL, DELIVERY_LABEL, type Audience, type Delivery } from "@/lib/announcements";

export function AnnouncementForm({
  action,
  areas,
  announcement,
  submitLabel,
}: {
  action: (formData: FormData) => Promise<void>;
  areas: { id: string; name: string }[];
  announcement?: { id: string; title: string; body: string; audience: Audience; area_id: string | null; delivery: Delivery };
  submitLabel: string;
}) {
  return (
    <form action={action} className="grid gap-5">
      {announcement ? <input type="hidden" name="announcementId" value={announcement.id} /> : null}
      <Field label="Otsikko" htmlFor="title" hint="Sähköpostin aihe ja kirjeen otsikko.">
        <Input id="title" name="title" defaultValue={announcement?.title} required maxLength={200} />
      </Field>
      <Field
        label="Teksti"
        htmlFor="body"
        hint="Tyhjä rivi aloittaa uuden kappaleen. Allekirjoitukseksi lisätään organisaation nimi ja yhteystiedot asetuksista. Jos tiedote on valmis PDF, sen voi liittää tallennuksen jälkeen; teksti on silloin vapaaehtoinen saate."
      >
        <Textarea id="body" name="body" defaultValue={announcement?.body} rows={14} maxLength={20000} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Vastaanottajat" htmlFor="audience">
          <Select id="audience" name="audience" defaultValue={announcement?.audience ?? "payers"}>
            {(Object.keys(AUDIENCE_LABEL) as Audience[]).map((k) => (
              <option key={k} value={k}>
                {AUDIENCE_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Alue" htmlFor="areaId">
          <Select id="areaId" name="areaId" defaultValue={announcement?.area_id ?? ""}>
            <option value="">Kaikki alueet</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Toimitustapa" htmlFor="delivery">
        <Select id="delivery" name="delivery" defaultValue={announcement?.delivery ?? "email_first"}>
          {(Object.keys(DELIVERY_LABEL) as Delivery[]).map((k) => (
            <option key={k} value={k}>
              {DELIVERY_LABEL[k]}
            </option>
          ))}
        </Select>
      </Field>
      <div>
        <Button>{submitLabel}</Button>
      </div>
    </form>
  );
}
