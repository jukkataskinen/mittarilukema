import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, LinkButton, Notice, PageHeader, Panel, SectionTitle, Select, Stat, Table, Td, Th } from "@/components/ui";
import { FormError } from "@/components/FormError";
import { requireRole } from "@/lib/auth/current-user";
import { formatDateTime, isoDateHelsinki } from "@/lib/format";
import { emailMode } from "@/lib/email";
import { letterMode } from "@/lib/letters";
import {
  ANNOUNCEMENT_STATUS, AUDIENCE_LABEL, CHANNEL_LABEL, DELIVERY_LABEL, findRecipients, RECIPIENT_STATUS,
  type Audience, type Channel, type Delivery,
} from "@/lib/announcements";
import {
  cancelLettersAction, confirmLettersAction, deleteAnnouncementAction, lockAnnouncementAction, markLettersAction, sendEmailsAction, sendTestEmailAction,
  uploadLettersAction,
} from "../actions";

const JOB_STATUS: Record<string, string> = {
  NE: "odottaa vahvistusta", CO: "vahvistettu, lähtee seuraavana arkipäivänä", PR: "käsittelyssä", SE: "lähetetty", CA: "peruttu",
};

export const metadata = { title: "Tiedote" };
// Sähköpostit lähtevät erissä; erä kestää noin 25 sekuntia.
export const maxDuration = 60;

export default async function AnnouncementPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireRole("owner", "staff");
  const orgId = ctx.org.organizationId;
  const data = await ctx.run(async (tx) => {
    const [a] = await tx.query<{
      id: string; title: string; body: string; audience: Audience; area_id: string | null; area_name: string | null; delivery: Delivery;
      status: string; locked_at: string | null; locked_by_name: string | null; contact_email: string | null; postal_street: string | null;
      letter_job_id: string | null; letter_job_status: string | null; letter_job_price: string | null; letter_post_class: number | null; letter_job_mode: string | null;
    }>(
      `select a.id, a.title, a.body, a.audience, a.area_id, ar.name as area_name, a.delivery, a.status, a.locked_at,
              coalesce(u.full_name, u.email) as locked_by_name, o.contact_email, o.postal_street,
              a.letter_job_id, a.letter_job_status, a.letter_job_price::text, a.letter_post_class, a.letter_job_mode
         from ml_announcements a join ml_organizations o on o.id = a.organization_id
         left join ml_areas ar on ar.id = a.area_id left join ml_users u on u.id = a.locked_by
        where a.id = $1 and a.organization_id = $2`,
      [id, orgId],
    );
    if (!a) return null;
    // Luonnoksessa vastaanottajat lasketaan nyt, lukitussa ne luetaan tallennetuista.
    const recipients =
      a.status === "draft"
        ? (await findRecipients(tx, orgId, a, isoDateHelsinki())).map((r) => ({ id: r.customer_id, customer_id: r.customer_id, name: r.name, channel: r.channel as Channel, status: r.channel === "none" ? "unreachable" : "pending", message: null as string | null, sent_at: null as string | null }))
        : await tx.query<{ id: string; customer_id: string | null; name: string; channel: Channel; status: string; message: string | null; sent_at: string | null }>(
            "select id, customer_id, name, channel, status, message, sent_at from ml_announcement_recipients where announcement_id = $1 order by channel, name",
            [id],
          );
    return { a, recipients };
  });
  if (!data) notFound();
  const { a, recipients } = data;
  const draft = a.status === "draft";
  const count = (ch: Channel, st?: string[]) => recipients.filter((r) => r.channel === ch && (!st || st.includes(r.status))).length;
  const mode = emailMode();
  const lMode = letterMode();
  const jobWaiting = a.letter_job_status === "NE";
  const unreachable = recipients.filter((r) => r.channel === "none");
  const lettersPending = count("letter", ["pending"]);
  const emailsLeft = count("email", ["pending", "failed"]);
  const status = ANNOUNCEMENT_STATUS[a.status] ?? { label: a.status, tone: "neutral" as const };

  return (
    <>
      <PageHeader
        title={a.title}
        subtitle={[AUDIENCE_LABEL[a.audience].split(" (")[0], a.area_name ?? "Kaikki alueet", DELIVERY_LABEL[a.delivery]].join(" · ")}
        back={{ href: "/tiedotteet", label: "Tiedotteet" }}
        actions={<Badge tone={status.tone}>{status.label}</Badge>}
      />
      <FormError message={sp.virhe} />
      {sp.lahetetty !== undefined ? (
        <div className="mb-5">
          <Notice tone={Number(sp.epaonnistui) ? "warn" : "ok"} title="Sähköpostierä käsitelty">
            Lähetetty {sp.lahetetty}, epäonnistui {sp.epaonnistui}, lähettämättä {sp.jaljella}.
            {mode === "mock" ? " Sähköposti on testitilassa: viestejä ei lähetetty oikeasti." : ""}
          </Notice>
        </div>
      ) : null}
      {sp.koeviesti ? (
        <div className="mb-5">
          <Notice tone="ok" title={mode === "mock" ? "Koeviesti muodostettu (testitila, ei lähetetty)" : "Koeviesti lähetetty omaan sähköpostiisi"} />
        </div>
      ) : null}
      {sp.kirjeet ? (
        <div className="mb-5">
          <Notice tone="info" title={`${sp.kirjeet} kirjettä ladattu ${a.letter_job_mode === "mock" ? "testitilassa (ei lähetetty Postitaan)" : "Postitaan"}.`}>
            Tarkista vedos Postitan verkkopalvelussa ja vahvista postitus alta. Vahvistetut kirjeet lähtevät seuraavana arkipäivänä.
          </Notice>
        </div>
      ) : null}
      {sp.postitettu ? (
        <div className="mb-5">
          <Notice tone="ok" title={`${sp.postitettu} kirjettä merkitty postitetuiksi.`} />
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Sähköposti" value={count("email")} />
        <Stat label="Kirje" value={count("letter")} />
        <Stat label="Ei tavoitettavissa" value={unreachable.length} tone={unreachable.length ? "alert" : "ok"} />
      </div>

      {!a.contact_email || !a.postal_street ? (
        <div className="mt-5">
          <Notice tone="warn" title="Organisaation yhteystiedot puuttuvat">
            Tiedotteen allekirjoitukseen ja kirjeen lähettäjäksi tulevat nimi, osoite ja yhteystiedot. Pääkäyttäjä lisää ne kohdassa{" "}
            <Link href="/asetukset" className="font-semibold underline">
              Asetukset
            </Link>
            . Sähköpostin vastaukset ohjataan organisaation sähköpostiin.
          </Notice>
        </div>
      ) : null}

      <section className="mt-8">
        <SectionTitle>Tiedote</SectionTitle>
        <Panel>
          <p className="whitespace-pre-line text-sm leading-relaxed">{a.body}</p>
        </Panel>
      </section>

      <section className="mt-8">
        <SectionTitle>{draft ? "Lähetys" : "Toimitus"}</SectionTitle>
        <Panel>
          {draft ? (
            <>
              <p className="text-sm text-ink/70">
                Vastaanottajat on laskettu tämän päivän sopimuksista. Tarkista tiedote koeviestillä ja kirjeen koetulosteella. Kun lukitset vastaanottajat,
                tiedotetta ei voi enää muuttaa, ja sähköpostit ja kirjeet lähetetään lukituille vastaanottajille.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <LinkButton href={`/tiedotteet/${id}/muokkaa`} variant="secondary">Muokkaa</LinkButton>
                <form action={sendTestEmailAction}>
                  <input type="hidden" name="announcementId" value={id} />
                  <Button variant="secondary">Koeviesti itselleni</Button>
                </form>
                <a href={`/api/tiedotteet/${id}/kirjeet?koe=1`} className="inline-flex min-h-10 items-center rounded-xl border border-line px-4 text-sm font-semibold hover:bg-cloud">
                  Kirjeen koetuloste (PDF)
                </a>
                <form action={lockAnnouncementAction}>
                  <input type="hidden" name="announcementId" value={id} />
                  <Button>Lukitse vastaanottajat ja aloita lähetys</Button>
                </form>
                <form action={deleteAnnouncementAction}>
                  <input type="hidden" name="announcementId" value={id} />
                  <Button variant="secondary">Poista luonnos</Button>
                </form>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-ink/70">
                {a.locked_by_name ?? "Käyttäjä"} lukitsi vastaanottajat {formatDateTime(a.locked_at)}.
                {mode === "mock" ? " Sähköposti on testitilassa: viestejä ei lähetetä oikeasti ennen kuin sähköpostipalvelu on otettu käyttöön." : ""}
              </p>
              <div className="mt-4 grid gap-6 sm:grid-cols-2">
                <div>
                  <p className="text-sm font-semibold">Sähköpostit</p>
                  <p className="mt-1 text-sm text-ink/70">
                    Lähetetty {count("email", ["sent"])} / {count("email")}. Lähettämättä {emailsLeft}.
                  </p>
                  {emailsLeft ? (
                    <form action={sendEmailsAction} className="mt-3">
                      <input type="hidden" name="announcementId" value={id} />
                      <Button>Lähetä seuraavat {Math.min(40, emailsLeft)} sähköpostia</Button>
                    </form>
                  ) : null}
                </div>
                <div>
                  <p className="text-sm font-semibold">Kirjeet</p>
                  <p className="mt-1 text-sm text-ink/70">
                    Postitettu {count("letter", ["printed"])} / {count("letter")}. Lähettämättä {lettersPending}.
                  </p>
                  {a.letter_job_id ? (
                    <p className="mt-1 text-sm text-ink/70">
                      Postitan työ {a.letter_job_mode === "mock" ? "(testitila)" : a.letter_job_id}: {JOB_STATUS[a.letter_job_status ?? ""] ?? a.letter_job_status}
                      {a.letter_post_class ? `, ${a.letter_post_class}. luokka` : ""}
                      {a.letter_job_price ? `, hinta ${a.letter_job_price.replace(".", ",")} €` : ""}.
                    </p>
                  ) : null}
                  {jobWaiting ? (
                    <div className="mt-3 flex flex-wrap gap-3">
                      <form action={confirmLettersAction}>
                        <input type="hidden" name="announcementId" value={id} />
                        <Button>Vahvista postitus ({count("letter", ["sending"])} kirjettä)</Button>
                      </form>
                      <form action={cancelLettersAction}>
                        <input type="hidden" name="announcementId" value={id} />
                        <Button variant="secondary">Peru</Button>
                      </form>
                    </div>
                  ) : lettersPending ? (
                    <>
                      {lMode ? (
                        <form action={uploadLettersAction} className="mt-3 flex flex-wrap items-end gap-3">
                          <input type="hidden" name="announcementId" value={id} />
                          <label className="text-sm">
                            <span className="sr-only">Postiluokka</span>
                            <Select name="postClass" defaultValue="2" aria-label="Postiluokka">
                              <option value="2">2. luokka (Economy)</option>
                              <option value="1">1. luokka (Priority)</option>
                            </Select>
                          </label>
                          <Button>
                            Lähetä {lettersPending} kirjettä Postitan kautta{lMode === "mock" ? " (testitila)" : ""}
                          </Button>
                        </form>
                      ) : null}
                      <details className="mt-3 text-sm">
                        <summary className="cursor-pointer text-ink/65">Tulosta ja postita itse</summary>
                        <div className="mt-3 flex flex-wrap gap-3">
                          <a href={`/api/tiedotteet/${id}/kirjeet?koe=1`} className="inline-flex min-h-10 items-center rounded-xl border border-line px-4 text-sm font-semibold hover:bg-cloud">
                            Koetuloste
                          </a>
                          <a href={`/api/tiedotteet/${id}/kirjeet`} className="inline-flex min-h-10 items-center rounded-xl border border-line px-4 text-sm font-semibold hover:bg-cloud">
                            Lataa {lettersPending} kirjettä (PDF)
                          </a>
                          <form action={markLettersAction}>
                            <input type="hidden" name="announcementId" value={id} />
                            <Button variant="secondary">Merkitse postitetuiksi</Button>
                          </form>
                        </div>
                      </details>
                    </>
                  ) : count("letter") ? (
                    <a href={`/api/tiedotteet/${id}/kirjeet?kaikki=1`} className="mt-3 inline-flex min-h-10 items-center rounded-xl border border-line px-4 text-sm font-semibold hover:bg-cloud">
                      Lataa kirjeet (PDF)
                    </a>
                  ) : null}
                </div>
              </div>
            </>
          )}
        </Panel>
      </section>

      {unreachable.length ? (
        <div className="mt-6">
          <Notice tone="warn" title={`${unreachable.length} vastaanottajaa ei tavoiteta`}>
            Heiltä puuttuu sekä sähköposti että täydellinen postiosoite. Lisää tiedot asiakkaan sivulla{draft ? " ennen lukitusta" : ""}.
          </Notice>
        </div>
      ) : null}

      <section className="mt-8">
        <SectionTitle>Vastaanottajat ({recipients.length})</SectionTitle>
        <Table>
          <thead>
            <tr>
              <Th>Asiakas</Th>
              <Th>Toimitustapa</Th>
              <Th>Tila</Th>
            </tr>
          </thead>
          <tbody>
            {recipients.map((r) => {
              const st = RECIPIENT_STATUS[r.status] ?? { label: r.status, tone: "neutral" as const };
              return (
                <tr key={r.id}>
                  <Td>
                    {r.customer_id ? (
                      <Link href={`/asiakkaat/${r.customer_id}`} className="font-semibold hover:text-sky">
                        {r.name}
                      </Link>
                    ) : (
                      r.name
                    )}
                  </Td>
                  <Td>{CHANNEL_LABEL[r.channel]}</Td>
                  <Td>
                    <Badge tone={st.tone}>{st.label}</Badge>
                    {r.message ? <span className="mt-1 block text-xs text-ink/65">{r.message}</span> : null}
                    {r.sent_at ? <span className="block text-xs text-ink/50">{formatDateTime(r.sent_at)}</span> : null}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </section>
    </>
  );
}
