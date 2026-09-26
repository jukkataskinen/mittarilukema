import type { Sql } from "@/lib/db/types";
import { audit } from "@/lib/audit";
import { CHANNEL_LABEL, type InvoiceChannel } from "./channel";
import { FennoaError, type FennoaClient, type FennoaReadBack } from "./index";
import { buildFennoaInvoice, type BuildResult, type ExportInvoice } from "./invoice";

export class FennoaExportError extends Error {}

type Runner = <T>(fn: (tx: Sql) => Promise<T>) => Promise<T>;

export interface ExportSummary {
  exported: number;
  blocked: number;
  failed: number;
  mismatch: number;
  remaining: number;
}

/** Fennoan raja on 5 pyyntöä sekunnissa; lasku on kaksi pyyntöä (luonti ja tarkistus). */
const PAUSE_MS = 250;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Hyväksytyn laskutusajon laskut Fennoaan luonnoksiksi, enintään `batch`
 * laskua kerralla (palvelinfunktion aikaraja). Uudelleenajo jatkaa siitä,
 * mihin jäätiin: jo viety, kesken jäänyt tai poikkeava lasku ei lähde toiseen kertaan.
 *
 * Kolme vaihetta, jottei tietokantatransaktio ole auki Fennoa-kutsujen ajan:
 *  1. laskut varataan tilaan pending (yksilöllinen indeksi estää rinnakkaisen viennin)
 *  2. lasku luodaan Fennoaan ja luetaan takaisin: laskukanava ja summa verrataan
 *  3. tulos kirjataan (exported, mismatch tai failed)
 * Puutteellisen kanavan lasku kirjataan tilaan blocked eikä sitä lähetetä
 * minkään muun kanavan kautta.
 */
export async function exportRunToFennoa(
  run: Runner,
  client: FennoaClient,
  input: { organizationId: string; userId: string; runId: string; invoiceDate: string; dueDate: string; batch?: number },
): Promise<ExportSummary> {
  const { organizationId: orgId, runId } = input;
  const env = client.environment;
  if (input.dueDate < input.invoiceDate) throw new FennoaExportError("Eräpäivä on ennen laskupäivää.");

  // 1. Valinta ja varaus
  const prepared = await run(async (tx) => {
    const [r] = await tx.query<{ status: string }>("select status from ml_billing_runs where id = $1 and organization_id = $2", [runId, orgId]);
    if (!r) throw new FennoaExportError("Laskutusajoa ei löytynyt.");
    // Testitilaan ja Fennoan testiyritykseen voi viedä myös luonnoksen, jotta vientiä voi kokeilla
    // lukitsematta ajoa (hyväksytty arvioajo vaikuttaa tasaukseen). Tuotantoon vain hyväksytty.
    const testEnvironment = env === "mock" || env === "test";
    if (r.status !== "approved" && !testEnvironment) throw new FennoaExportError("Vain hyväksytyn ajon voi viedä Fennoaan.");

    const invoices = await tx.query<{
      id: string; info: string | null; gross_eur: string; period_start: string; period_end: string;
      customer_id: string | null; kind: "person" | "company" | null; name: string | null; email: string | null; phone: string | null;
      invoice_channel: string | null; einvoice_address: string | null; einvoice_operator: string | null;
      billing_street: string | null; billing_postal_code: string | null; billing_city: string | null;
      customer_number: string | null; fennoa_customer_id: string | null;
    }>(
      `select i.id, i.info, i.gross_eur::text, i.period_start::text, i.period_end::text, i.customer_id,
              c.kind, c.name, c.email, c.phone, c.invoice_channel, c.einvoice_address, c.einvoice_operator,
              c.billing_street, c.billing_postal_code, c.billing_city, c.customer_number, c.fennoa_customer_id
         from ml_invoices i left join ml_customers c on c.id = i.customer_id
        where i.run_id = $1 and i.organization_id = $2 and i.status <> 'excluded'
          and not exists (select 1 from ml_fennoa_exports e where e.invoice_id = i.id and e.environment = $3
                          and e.status in ('pending', 'exported', 'mismatch'))
        -- Ensin laskut, joita ei ole vielä yritetty; aiemmin epäonnistuneet vasta niiden jälkeen,
        -- jottei sama epäonnistuva erä (esim. puuttuva e-laskutussopimus) pysäytä vientiä.
        order by exists (select 1 from ml_fennoa_exports f where f.invoice_id = i.id and f.environment = $3 and f.status = 'failed'), i.id`,
      [runId, orgId, env],
    );
    const pick = invoices;
    // Laskentakohteen dimensiotyyppi Fennoassa (esim. "dim1"); tyhjä = Fennoa käyttää tuotteen oletusta.
    const [orgRow] = await tx.query<{ fennoa_cost_center_dim: string | null }>("select fennoa_cost_center_dim from ml_organizations where id = $1", [orgId]);
    const costCenterDim = orgRow?.fennoa_cost_center_dim ?? null;
    const lines = pick.length
      ? await tx.query<{
          invoice_id: string; description: string; quantity: string; unit: "m3" | "month" | "year"; unit_price: string;
          vat_percent: string; net_eur: string; vat_eur: string | null; price_includes_vat: boolean;
          product_code: string | null; account_code: string | null; cost_center_code: string | null;
        }>(
          `select invoice_id, description, quantity::text, unit, unit_price::text, vat_percent::text, net_eur::text, vat_eur::text, price_includes_vat,
                  product_code, account_code, cost_center_code
             from ml_invoice_lines where invoice_id = any($1::uuid[]) order by invoice_id, line_no`,
          [pick.map((i) => i.id)],
        )
      : [];

    const out: { invoiceId: string; gross: number; build: BuildResult; exportId?: string }[] = [];
    const batch = input.batch ?? 25;
    let sendable = 0;
    let remaining = 0;
    for (const i of pick) {
      const inv: ExportInvoice = {
        customer: {
          kind: i.kind ?? "person", name: i.name, email: i.email, phone: i.phone, invoice_channel: i.invoice_channel,
          einvoice_address: i.einvoice_address, einvoice_operator: i.einvoice_operator, billing_street: i.billing_street,
          billing_postal_code: i.billing_postal_code, billing_city: i.billing_city, customer_number: i.customer_number,
          fennoa_customer_id: i.fennoa_customer_id,
        },
        info: i.info, gross_eur: Number(i.gross_eur), period_start: i.period_start, period_end: i.period_end,
        lines: lines.filter((l) => l.invoice_id === i.id).map((l) => ({
          description: l.description, quantity: Number(l.quantity), unit: l.unit, unit_price: Number(l.unit_price),
          vat_percent: Number(l.vat_percent), net_eur: Number(l.net_eur), vat_eur: l.vat_eur === null ? null : Number(l.vat_eur),
          price_includes_vat: l.price_includes_vat, product_code: l.product_code, account_code: l.account_code, cost_center_code: l.cost_center_code,
        })),
      };
      const build: BuildResult = i.customer_id
        ? buildFennoaInvoice(inv, { invoiceDate: input.invoiceDate, dueDate: input.dueDate, costCenterDim: costCenterDim })
        : { ok: false as const, problems: ["Laskulta puuttuu maksaja."] };
      // Estetyt kirjataan kaikki (ei Fennoa-kutsuja), lähetettävistä vain erän verran.
      if (build.ok && sendable >= batch) {
        remaining++;
        continue;
      }
      if (build.ok) sendable++;
      // Aiempi estetty tai epäonnistunut yritys korvataan uudella.
      await tx.query("delete from ml_fennoa_exports where invoice_id = $1 and environment = $2 and status in ('blocked', 'failed')", [i.id, env]);
      const [row] = await tx.query<{ id: string }>(
        `insert into ml_fennoa_exports (organization_id, run_id, invoice_id, environment, status, channel, delivery_method,
                                        gross_eur, invoice_date, due_date, message, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
        [
          orgId, runId, i.id, env, build.ok ? "pending" : "blocked", i.invoice_channel, build.ok ? build.deliveryMethod : null,
          i.gross_eur, input.invoiceDate, input.dueDate, build.ok ? null : build.problems.join(" "), input.userId,
        ],
      );
      out.push({ invoiceId: i.id, gross: Number(i.gross_eur), build, exportId: row.id });
    }
    return { items: out, remaining };
  });

  // 2. Fennoa
  const results: { exportId: string; status: "exported" | "mismatch" | "failed"; fennoaId: string | null; confirmed: string | null; confirmedGross: number | null; message: string | null }[] = [];
  for (const item of prepared.items) {
    if (!item.build.ok || !item.exportId) continue;
    const expected = item.build.deliveryMethod;
    try {
      const { id } = await client.addInvoice(item.build.form);
      await sleep(client.environment === "mock" ? 0 : PAUSE_MS);
      let back: FennoaReadBack = { deliveryMethod: null, gross: null };
      let readError: string | null = null;
      try {
        back = await client.getInvoice(id, { einvoiceAddress: item.build.form.einvoice_address, einvoiceOperator: item.build.form.einvoice_operator });
      } catch (err) {
        readError = err instanceof Error ? err.message : "tuntematon virhe";
      }
      await sleep(client.environment === "mock" ? 0 : PAUSE_MS);
      const problems: string[] = [];
      // Fennoan luonnoksen delivery_method on rajapinnassa tyhjä, vaikka toimitustapa on Fennoassa
      // oikein (testit 25.9.2026), eikä verkkolaskuosoitetta palauteta. Tyhjä kenttä ei siis kerro
      // virheestä: Fennoa tarkistaa toimitustavan jo luodessaan laskun (esim. hylkää kuluttajan
      // e-laskun ilman sopimusta). Eri kanava kentässä on aina poikkeama.
      const confirmedByAddress = back.deliveryMethod === null && expected !== "postal" && back.einvoiceMatch === true;
      // Jos Fennoa palauttaa osoitteen ja se eroaa lähetetystä, lasku on poikkeama.
      const acceptedByFennoa = back.deliveryMethod === null && back.einvoiceMatch == null;
      if (readError) {
        problems.push(`Laskua ei voitu lukea takaisin (${readError}). Tarkista laskukanava Fennoasta.`);
      } else if (back.deliveryMethod !== expected && !confirmedByAddress && !acceptedByFennoa) {
        problems.push(
          `Fennoa tallensi laskukanavaksi "${back.deliveryMethod ?? "tyhjä"}", odotettiin "${expected}" (${CHANNEL_LABEL[item.build.channel as InvoiceChannel]}). Korjaa lasku Fennoassa ennen lähetystä.` +
            (back.deliveryFields?.length ? ` Fennoan kentät: ${back.deliveryFields.join(", ")}.` : "") +
            // Kun kanavaa ei löydy mistään, kirjataan vastauksen kenttien nimet (ei arvoja) selvitystä varten.
            (back.deliveryMethod === null && back.einvoiceMatch == null && back.fieldNames?.length ? ` Vastauksen kentät: ${back.fieldNames.join(", ")}.` : ""),
        );
      }
      if (!readError && back.gross !== null && Math.abs(back.gross - round2(item.gross)) >= 0.005) {
        problems.push(`Fennoan laskun summa ${back.gross.toFixed(2)} € poikkeaa laskusta ${item.gross.toFixed(2)} €.`);
      }
      results.push({
        exportId: item.exportId, status: problems.length ? "mismatch" : "exported", fennoaId: id, confirmed: back.deliveryMethod,
        confirmedGross: back.gross,
        message: problems.length
          ? problems.join(" ")
          : [
              confirmedByAddress ? "Laskukanava varmistettu Fennoan tallentamasta osoitteesta." : null,
              acceptedByFennoa && !readError
                ? `Fennoa hyväksyi laskun toimitustavalla ${CHANNEL_LABEL[item.build.channel as InvoiceChannel].toLowerCase()}; luonnoksen toimitustapaa ei voi lukea rajapinnasta, tarkista pistokokein Fennoassa.`
                : null,
              back.gross === null ? "Summaa ei saatu tarkistettua Fennoan vastauksesta." : null,
            ]
              .filter(Boolean).join(" ") || null,
      });
    } catch (err) {
      results.push({
        exportId: item.exportId, status: "failed", fennoaId: null, confirmed: null, confirmedGross: null,
        message: err instanceof FennoaError ? err.message : "Yhteys Fennoaan epäonnistui.",
      });
      // Tunnusvirhe koskee kaikkia laskuja: ei jatketa.
      if (err instanceof FennoaError && (err.status === 401 || err.status === 403)) break;
    }
  }

  // 3. Kirjaus. Lähettämättä jääneet (tunnusvirheen jälkeen) vapautetaan uutta yritystä varten.
  return run(async (tx) => {
    for (const r of results) {
      await tx.query(
        `update ml_fennoa_exports set status = $2, fennoa_invoice_id = $3, confirmed_delivery_method = $4, confirmed_gross_eur = $5,
                message = $6, updated_at = now() where id = $1`,
        [r.exportId, r.status, r.fennoaId, r.confirmed, r.confirmedGross, r.message],
      );
    }
    const done = new Set(results.map((r) => r.exportId));
    const untouched = prepared.items.filter((i) => i.build.ok && i.exportId && !done.has(i.exportId)).map((i) => i.exportId!);
    if (untouched.length) await tx.query("delete from ml_fennoa_exports where id = any($1::uuid[])", [untouched]);
    const summary: ExportSummary = {
      exported: results.filter((r) => r.status === "exported").length,
      mismatch: results.filter((r) => r.status === "mismatch").length,
      failed: results.filter((r) => r.status === "failed").length,
      blocked: prepared.items.filter((i) => !i.build.ok).length,
      remaining: prepared.remaining + untouched.length,
    };
    await audit(tx, {
      organizationId: orgId, userId: input.userId, action: "fennoa.export", entity: "ml_billing_runs", entityId: runId,
      details: { environment: env, invoiceDate: input.invoiceDate, dueDate: input.dueDate, ...summary },
    });
    return summary;
  });
}

/** Viennin tilanne ajolle: määrät tiloittain ja laskukanavittain. */
export async function runExportStatus(tx: Sql, orgId: string, runId: string, env: string) {
  const byStatus = await tx.query<{ status: string; n: number }>(
    `select e.status, count(*)::int as n from ml_fennoa_exports e
      where e.organization_id = $1 and e.run_id = $2 and e.environment = $3
        and e.created_at = (select max(x.created_at) from ml_fennoa_exports x where x.invoice_id = e.invoice_id and x.environment = e.environment)
      group by e.status`,
    [orgId, runId, env],
  );
  const byChannel = await tx.query<{ channel: string | null; n: number; problems: number }>(
    `select c.invoice_channel as channel, count(*)::int as n,
            count(*) filter (where c.id is null or c.billing_street is null or c.billing_postal_code is null)::int as problems
       from ml_invoices i left join ml_customers c on c.id = i.customer_id
      where i.organization_id = $1 and i.run_id = $2 and i.status <> 'excluded'
      group by c.invoice_channel order by c.invoice_channel nulls first`,
    [orgId, runId],
  );
  return { byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.n])) as Record<string, number>, byChannel };
}

/** Laskun viimeisin vienti (laskun sivulle ja ajon listaan). */
export function latestExports(tx: Sql, orgId: string, runId: string, env: string) {
  return tx.query<{ invoice_id: string; status: string; message: string | null; fennoa_invoice_id: string | null; channel: string | null; confirmed_delivery_method: string | null }>(
    `select distinct on (invoice_id) invoice_id, status, message, fennoa_invoice_id, channel, confirmed_delivery_method
       from ml_fennoa_exports where organization_id = $1 and run_id = $2 and environment = $3
      order by invoice_id, created_at desc`,
    [orgId, runId, env],
  );
}
