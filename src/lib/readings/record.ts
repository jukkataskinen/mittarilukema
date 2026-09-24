import type { Sql } from "@/lib/db/types";
import { audit } from "@/lib/audit";
import { readingIssues, type PreviousReading, type ReadingIssue } from "./checks";

export type ReadingSource = "remote" | "sms" | "reader" | "staff" | "form" | "import" | "estimate";

export interface NewReading {
  organizationId: string;
  meterId: string;
  readOn: string;
  reading: number;
  source: ReadingSource;
  userId: string | null;
  roundId?: string | null;
  note?: string | null;
}

/**
 * Kaksi viimeisintä hyväksyttyä lukemaa ennen annettua päivää. Jos lukemia
 * ei ole, vertailukohta on mittarin aloituslukema asennuspäivänä.
 */
export async function previousReadings(tx: Sql, meterId: string, before: string): Promise<PreviousReading[]> {
  const rows = await tx.query<{ reading: string; read_on: string }>(
    `select reading::text, read_on::text from (
        select reading, read_on from ml_readings
         where meter_id = $1 and status = 'accepted' and read_on < $2
        union all
        select start_reading, installed_on from ml_meters where id = $1 and installed_on < $2
     ) r order by read_on desc limit 2`,
    [meterId, before],
  );
  return rows.map((r) => ({ reading: Number(r.reading), readOn: r.read_on }));
}

/**
 * Kirjaa lukeman. Poikkeava lukema jää tilaan `needs_review`, muut
 * hyväksytään suoraan. Toimiston kirjaus samalle päivälle korvaa aiemman
 * lukeman (hylkää sen), jotta virheellisen lukeman voi korjata.
 */
export async function recordReading(tx: Sql, r: NewReading): Promise<{ id: string; issues: ReadingIssue[] }> {
  const [prev = null, beforePrev = null] = await previousReadings(tx, r.meterId, r.readOn);
  const issues = readingIssues(r.reading, r.readOn, prev, beforePrev);
  const status = issues.length ? "needs_review" : "accepted";

  if (r.source === "staff") {
    await tx.query(
      "update ml_readings set status = 'rejected', reviewed_by = $3, reviewed_at = now() where meter_id = $1 and read_on = $2 and status <> 'rejected'",
      [r.meterId, r.readOn, r.userId],
    );
  }
  const [row] = await tx.query<{ id: string }>(
    `insert into ml_readings (organization_id, meter_id, round_id, read_on, reading, source, status, issues, note, entered_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
    [r.organizationId, r.meterId, r.roundId ?? null, r.readOn, r.reading, r.source, status, issues, r.note ?? null, r.userId],
  );
  if (r.userId) {
    await audit(tx, {
      organizationId: r.organizationId,
      userId: r.userId,
      action: "reading.create",
      entity: "ml_readings",
      entityId: row.id,
      details: { source: r.source, status },
    });
  }
  return { id: row.id, issues };
}

/** Tarkistettavan lukeman hyväksyntä tai hylkäys. */
export async function reviewReading(
  tx: Sql,
  input: { organizationId: string; readingId: string; userId: string; decision: "accepted" | "rejected" },
): Promise<boolean> {
  const rows = await tx.query(
    "update ml_readings set status = $2, reviewed_by = $3, reviewed_at = now() where id = $1 and organization_id = $4 and status = 'needs_review' returning id",
    [input.readingId, input.decision, input.userId, input.organizationId],
  );
  if (rows.length === 0) return false;
  await audit(tx, {
    organizationId: input.organizationId,
    userId: input.userId,
    action: `reading.${input.decision === "accepted" ? "accept" : "reject"}`,
    entity: "ml_readings",
    entityId: input.readingId,
  });
  return true;
}
