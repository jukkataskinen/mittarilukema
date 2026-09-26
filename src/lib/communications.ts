import type { Sql } from "@/lib/db/types";
import { CHANNEL_LABEL as INVOICE_CHANNEL_LABEL, isInvoiceChannel } from "@/lib/fennoa/channel";
import { CHANNEL_LABEL as ANNOUNCEMENT_CHANNEL_LABEL, RECIPIENT_STATUS, type Channel } from "@/lib/announcements";

/**
 * Asiakkaan lähetysloki: mitä asiakkaalle on lähetetty ja mitä kanavaa pitkin.
 * Kootaan lähetyshetken tiedoista, jotta näkyy, mihin osoitteeseen viesti
 * todella lähti, vaikka asiakkaan tiedot olisivat sen jälkeen muuttuneet:
 *   - tiedotteet (ml_announcement_recipients: kanava, sähköposti tai postiosoite)
 *   - laskujen viennit Fennoaan (ml_fennoa_exports: laskukanava ja viennin tila)
 */

export interface CommunicationRow {
  at: string;
  kind: "announcement" | "invoice";
  title: string;
  channel: string;
  destination: string | null;
  status: string;
  tone: "neutral" | "ok" | "warn" | "alert";
  href: string;
  note: string | null;
}

const EXPORT_STATUS: Record<string, { label: string; tone: CommunicationRow["tone"] }> = {
  exported: { label: "Viety Fennoaan", tone: "ok" },
  pending: { label: "Vienti kesken", tone: "warn" },
  mismatch: { label: "Poikkeama", tone: "alert" },
  blocked: { label: "Estetty", tone: "alert" },
  failed: { label: "Epäonnistui", tone: "alert" },
};
const ENVIRONMENT: Record<string, string> = { mock: "testitila", test: "Fennoan testiympäristö" };

export async function customerCommunications(tx: Sql, orgId: string, customerId: string): Promise<CommunicationRow[]> {
  const announcements = await tx.query<{
    announcement_id: string; title: string; channel: Channel; email: string | null; address_lines: string[]; status: string;
    sent_at: string | null; locked_at: string | null; letter_job_mode: string | null; has_pdf: boolean;
  }>(
    `select a.id as announcement_id, a.title, r.channel, r.email, r.address_lines, r.status, r.sent_at, a.locked_at, a.letter_job_mode,
            exists (select 1 from ml_announcement_attachments t where t.announcement_id = a.id) as has_pdf
       from ml_announcement_recipients r join ml_announcements a on a.id = r.announcement_id
      where r.organization_id = $1 and r.customer_id = $2`,
    [orgId, customerId],
  );
  const exports = await tx.query<{
    run_id: string; invoice_id: string; period_start: string; period_end: string; channel: string | null; status: string;
    environment: string; created_at: string; message: string | null; gross_eur: string | null;
  }>(
    `select distinct on (e.invoice_id, e.environment) e.run_id, e.invoice_id, i.period_start::text, i.period_end::text, e.channel, e.status,
            e.environment, e.created_at, e.message, e.gross_eur::text
       from ml_fennoa_exports e join ml_invoices i on i.id = e.invoice_id
      where e.organization_id = $1 and i.customer_id = $2
      order by e.invoice_id, e.environment, e.created_at desc`,
    [orgId, customerId],
  );

  const fi = (iso: string) => {
    const [y, m, d] = iso.slice(0, 10).split("-");
    return `${Number(d)}.${Number(m)}.${y}`;
  };
  // Aikaleima voi tulla kannasta Date-oliona (pg, PGlite) tai merkkijonona.
  const iso = (v: string | Date | null) => (v ? new Date(v).toISOString() : "");
  const addDay = (iso: string) => new Date(Date.parse(`${iso}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

  const rows: CommunicationRow[] = [
    ...announcements.map((r): CommunicationRow => {
      const st = RECIPIENT_STATUS[r.status] ?? { label: r.status, tone: "neutral" as const };
      const via = r.channel === "letter" ? (r.letter_job_mode === "postita" ? "Kirje (Postita)" : "Kirje") : ANNOUNCEMENT_CHANNEL_LABEL[r.channel];
      return {
        at: iso(r.sent_at ?? r.locked_at),
        kind: "announcement",
        title: `Tiedote: ${r.title}${r.has_pdf ? " (PDF)" : ""}`,
        channel: via,
        destination: r.channel === "email" ? r.email : r.channel === "letter" ? r.address_lines.join(", ") : null,
        status: st.label,
        tone: st.tone,
        href: `/tiedotteet/${r.announcement_id}`,
        note: null,
      };
    }),
    ...exports.map((e): CommunicationRow => {
      const st = EXPORT_STATUS[e.status] ?? { label: e.status, tone: "neutral" as const };
      return {
        at: iso(e.created_at),
        kind: "invoice",
        title: `Lasku ${fi(addDay(e.period_start))} – ${fi(e.period_end)}${e.gross_eur ? `, ${e.gross_eur.replace(".", ",")} €` : ""}`,
        channel: e.channel && isInvoiceChannel(e.channel) ? INVOICE_CHANNEL_LABEL[e.channel] : "Laskukanava puuttui",
        destination: null,
        status: `${st.label} (${ENVIRONMENT[e.environment] ?? e.environment})`,
        tone: st.tone,
        href: `/laskutus/${e.run_id}/${e.invoice_id}`,
        note: e.status === "exported" ? null : e.message,
      };
    }),
  ];
  return rows.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
}
