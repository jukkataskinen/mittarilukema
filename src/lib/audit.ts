import type { Sql } from "@/lib/db/types";

/**
 * Tapahtumaloki samassa transaktiossa kuin muutos: jos muutos perutaan,
 * lokirivikin perutaan. Lokiin ei kirjoiteta henkilötietoja, vain tunnisteet
 * ja muuttuneiden kenttien nimet.
 */
export async function audit(
  tx: Sql,
  entry: { organizationId: string; userId: string; action: string; entity: string; entityId?: string | null; details?: Record<string, unknown> },
): Promise<void> {
  await tx.query(
    "insert into ml_audit_log (organization_id, user_id, action, entity, entity_id, details) values ($1, $2, $3, $4, $5, $6)",
    [entry.organizationId, entry.userId, entry.action, entry.entity, entry.entityId ?? null, JSON.stringify(entry.details ?? {})],
  );
}
