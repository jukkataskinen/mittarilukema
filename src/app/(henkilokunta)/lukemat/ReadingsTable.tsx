import Link from "next/link";
import { Badge, Table, Td, Th } from "@/components/ui";
import { ISSUE_LABEL, type ReadingIssue } from "@/lib/readings/checks";
import { READING_SOURCE, READING_STATUS } from "@/lib/labels";
import { formatDate, formatNumber } from "@/lib/format";
import type { ReadingRow } from "@/lib/registry/queries";
import { reviewReadingAction } from "./actions";

const STATUS_TONE = { accepted: "ok", needs_review: "alert", rejected: "neutral" } as const;

/** Lukemataulukko: työpöytä, lukemasivu ja kiinteistön sivu käyttävät samaa. */
export function ReadingsTable({
  rows,
  canReview,
  backTo,
  showProperty = true,
}: {
  rows: ReadingRow[];
  canReview: boolean;
  backTo: string;
  showProperty?: boolean;
}) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Päivä</Th>
          {showProperty ? <Th>Kiinteistö</Th> : null}
          <Th>Mittari</Th>
          <Th numeric>Lukema</Th>
          <Th numeric>Kulutus</Th>
          <Th>Lähde</Th>
          <Th>Tila</Th>
          {canReview ? <Th /> : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const usage = r.previous_reading !== null ? Number(r.reading) - Number(r.previous_reading) : null;
          return (
            <tr key={r.id} className={r.status === "rejected" ? "text-ink/45" : undefined}>
              <Td className="tabular whitespace-nowrap">{formatDate(r.read_on)}</Td>
              {showProperty ? (
                <Td>
                  <Link href={`/kiinteistot/${r.property_id}`} className="font-semibold hover:text-sky">
                    {r.street_address}
                  </Link>
                </Td>
              ) : null}
              <Td className="tabular">{r.meter_number ?? "–"}</Td>
              <Td numeric>{formatNumber(r.reading)}</Td>
              <Td numeric>{usage === null ? "–" : formatNumber(usage, "m³")}</Td>
              <Td className="whitespace-nowrap">
                {READING_SOURCE[r.source] ?? r.source}
                {r.entered_by_name ? <span className="block text-xs text-ink/50">{r.entered_by_name}</span> : null}
              </Td>
              <Td>
                <Badge tone={STATUS_TONE[r.status]}>{READING_STATUS[r.status]}</Badge>
                {r.issues.map((i) => (
                  <span key={i} className="mt-1 block text-xs text-ink/60">
                    {ISSUE_LABEL[i as ReadingIssue] ?? i}
                  </span>
                ))}
              </Td>
              {canReview ? (
                <Td className="whitespace-nowrap text-right">
                  {r.status === "needs_review" ? (
                    <form action={reviewReadingAction} className="inline-flex gap-3">
                      <input type="hidden" name="readingId" value={r.id} />
                      <input type="hidden" name="backTo" value={backTo} />
                      <button name="decision" value="accepted" className="text-sm font-semibold text-moss">
                        Hyväksy
                      </button>
                      <button name="decision" value="rejected" className="text-sm font-semibold text-coral">
                        Hylkää
                      </button>
                    </form>
                  ) : null}
                </Td>
              ) : null}
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
