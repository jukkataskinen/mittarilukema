import { Brand } from "@/components/Brand";
import { Button, Field, Input, Notice, Panel } from "@/components/ui";
import { getDb } from "@/lib/db";
import { resolveLink } from "@/lib/readings/links";
import { formatDate, formatNumber, isoDateHelsinki } from "@/lib/format";
import { submitReadingAction } from "./actions";

export const metadata = { title: "Ilmoita mittarilukema" };
export const dynamic = "force-dynamic";

/**
 * Julkinen lukemalomake. Näyttää vain sen, mitä asiakas tarvitsee lukeman
 * ilmoittamiseen: laitoksen, kiinteistön osoitteen, mittarinumeron ja
 * edellisen lukeman. Ei nimiä, asiakasnumeroita eikä laskutietoja.
 */
export default async function ReadingLinkPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ virhe?: string; kiitos?: string }>;
}) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const db = await getDb();
  const link = await db.asService((tx) => resolveLink(tx, token));
  const today = isoDateHelsinki();

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-5 py-10">
      <Brand size={26} />
      {!link ? (
        <div className="mt-10">
          <h1 className="text-2xl">Linkki ei ole voimassa</h1>
          <p className="mt-3 text-ink/70">
            Lukukierros on päättynyt tai linkki on vanhentunut. Voit ilmoittaa lukeman vesihuoltolaitokselle myös tekstiviestillä tai puhelimitse.
          </p>
        </div>
      ) : (
        <>
          <p className="mt-8 text-sm font-semibold text-ink/60">{link.organizationName}</p>
          <h1 className="mt-1 text-2xl">Ilmoita vesimittarin lukema</h1>
          <p className="mt-2 text-ink/70">
            {link.streetAddress}
            {link.meterNumber ? ` · mittari ${link.meterNumber}` : ""}
          </p>

          {sp.kiitos ? (
            <div className="mt-6">
              <Notice tone={sp.kiitos === "tarkistetaan" ? "warn" : "ok"} title="Kiitos, lukema on vastaanotettu.">
                {sp.kiitos === "tarkistetaan"
                  ? "Lukema poikkeaa aiemmista, joten laitos tarkistaa sen. Jos näppäilit väärin, voit korjata lukeman alla."
                  : "Voit korjata lukeman alla, jos näppäilit väärin."}
              </Notice>
            </div>
          ) : null}
          {sp.virhe ? (
            <div className="mt-6" role="alert">
              <Notice tone="alert" title="Lukemaa ei tallennettu">
                {sp.virhe}
              </Notice>
            </div>
          ) : null}

          <Panel className="mt-6">
            {link.previous ? (
              <p className="mb-4 text-sm text-ink/70">
                Edellinen lukema {formatNumber(link.previous.reading)} m³ ({formatDate(link.previous.readOn)})
              </p>
            ) : null}
            {link.submitted ? (
              <p className="mb-4 text-sm text-ink/70">
                Ilmoittamasi lukema {formatNumber(link.submitted.reading)} m³ ({formatDate(link.submitted.readOn)})
              </p>
            ) : null}
            <form action={submitReadingAction} className="grid gap-4">
              <input type="hidden" name="token" value={token} />
              <Field label="Lukema (m³)" htmlFor="reading" hint="Mustat numerot. Punaisia desimaaleja ei tarvitse ilmoittaa.">
                <Input id="reading" name="reading" inputMode="decimal" autoComplete="off" required className="text-xl" />
              </Field>
              <Field label="Lukemapäivä" htmlFor="readOn">
                <Input id="readOn" name="readOn" type="date" defaultValue={today} max={today} required />
              </Field>
              <Button>{link.submitted ? "Korjaa lukema" : "Lähetä lukema"}</Button>
            </form>
          </Panel>
          <p className="mt-6 text-xs text-ink/55">
            Linkki koskee vain tätä mittaria kierroksella {link.roundName}. Lukemapäivä {formatDate(link.targetDate)} tai sen jälkeen.
          </p>
        </>
      )}
    </div>
  );
}
