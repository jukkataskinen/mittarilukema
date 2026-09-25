import { PDFDocument } from "pdf-lib";
import type { Sql } from "@/lib/db/types";
import { audit } from "@/lib/audit";
import { AnnouncementError } from "./index";

/** Vercelin pyyntöraja on 4,5 Mt; liite enintään 4 Mt. */
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const MAX_PAGES = 50;

/**
 * Tarkistaa, että tiedosto on avattava PDF: tunniste, koko, salaamaton ja
 * sivumäärä. Palauttaa sivumäärän. Virheilmoitukset eivät sisällä tiedoston sisältöä.
 */
export async function validatePdf(bytes: Uint8Array): Promise<{ pages: number }> {
  if (bytes.length === 0) throw new AnnouncementError("Tiedosto on tyhjä.");
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new AnnouncementError("PDF on liian suuri (enintään 4 Mt).");
  if (Buffer.from(bytes.subarray(0, 5)).toString("latin1") !== "%PDF-") throw new AnnouncementError("Tiedosto ei ole PDF.");
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes);
  } catch (err) {
    const encrypted = err instanceof Error && /encrypt/i.test(err.message);
    throw new AnnouncementError(encrypted ? "PDF on suojattu salasanalla. Tallenna se ilman suojausta." : "PDF:ää ei voitu avata.");
  }
  const pages = doc.getPageCount();
  if (pages < 1) throw new AnnouncementError("PDF:ssä ei ole sivuja.");
  if (pages > MAX_PAGES) throw new AnnouncementError(`PDF:ssä on ${pages} sivua (enintään ${MAX_PAGES}).`);
  return { pages };
}

/** Tallentaa luonnoksen PDF-liitteen; uusi korvaa vanhan. */
export async function saveAttachment(
  tx: Sql,
  input: { organizationId: string; userId: string; announcementId: string; filename: string; bytes: Uint8Array },
) {
  const [a] = await tx.query<{ status: string }>("select status from ml_announcements where id = $1 and organization_id = $2", [
    input.announcementId, input.organizationId,
  ]);
  if (!a) throw new AnnouncementError("Tiedotetta ei löytynyt.");
  if (a.status !== "draft") throw new AnnouncementError("Lähetetyn tiedotteen liitettä ei voi muuttaa.");
  const { pages } = await validatePdf(input.bytes);
  const filename = input.filename.replace(/[\\/:*?"<>|\r\n]/g, "_").slice(0, 200) || "tiedote.pdf";
  await tx.query(
    `insert into ml_announcement_attachments (organization_id, announcement_id, filename, size_bytes, pages, data, created_by)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (announcement_id) do update set filename = excluded.filename, size_bytes = excluded.size_bytes, pages = excluded.pages,
       data = excluded.data, created_by = excluded.created_by, created_at = now()`,
    [input.organizationId, input.announcementId, filename, input.bytes.length, pages, Buffer.from(input.bytes), input.userId],
  );
  await audit(tx, {
    organizationId: input.organizationId, userId: input.userId, action: "announcement.attachment", entity: "ml_announcements",
    entityId: input.announcementId, details: { pages, bytes: input.bytes.length },
  });
  return { pages };
}

export async function deleteAttachment(tx: Sql, input: { organizationId: string; userId: string; announcementId: string }) {
  const rows = await tx.query(
    `delete from ml_announcement_attachments t using ml_announcements a
      where t.announcement_id = a.id and a.id = $1 and a.organization_id = $2 and a.status = 'draft' returning t.id`,
    [input.announcementId, input.organizationId],
  );
  if (rows.length) {
    await audit(tx, { organizationId: input.organizationId, userId: input.userId, action: "announcement.attachment_delete", entity: "ml_announcements", entityId: input.announcementId });
  }
  return rows.length > 0;
}

export interface Attachment {
  filename: string;
  pages: number;
  sizeBytes: number;
  data: Uint8Array;
}

export async function getAttachment(tx: Sql, orgId: string, announcementId: string): Promise<Attachment | null> {
  const [r] = await tx.query<{ filename: string; pages: number; size_bytes: number; data: Uint8Array | Buffer | string }>(
    "select filename, pages, size_bytes, data from ml_announcement_attachments where announcement_id = $1 and organization_id = $2",
    [announcementId, orgId],
  );
  if (!r) return null;
  // Postgres palauttaa Bufferin, PGlite Uint8Arrayn.
  const data = typeof r.data === "string" ? Buffer.from(r.data.replace(/^\\x/, ""), "hex") : new Uint8Array(r.data);
  return { filename: r.filename, pages: r.pages, sizeBytes: r.size_bytes, data };
}

/** Liitteen tiedot ilman sisältöä (sivun näyttämiseen). */
export async function attachmentInfo(tx: Sql, orgId: string, announcementId: string) {
  const [r] = await tx.query<{ filename: string; pages: number; size_bytes: number }>(
    "select filename, pages, size_bytes from ml_announcement_attachments where announcement_id = $1 and organization_id = $2",
    [announcementId, orgId],
  );
  return r ?? null;
}
