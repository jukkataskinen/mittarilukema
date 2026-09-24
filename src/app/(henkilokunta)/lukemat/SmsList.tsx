import Link from "next/link";
import { Badge, Button, EmptyState, Field, Input, Notice, Panel, Table, Td, Th } from "@/components/ui";
import type { Sql } from "@/lib/db/types";
import { formatDateTime } from "@/lib/format";
import { formatPhone } from "@/lib/validation/phone";
import { markSmsHandledAction, simulateSmsAction } from "./sms-actions";

const STATUS: Record<string, { label: string; tone: "ok" | "warn" | "alert" | "neutral" }> = {
  recorded: { label: "Kirjattu", tone: "ok" },
  needs_review: { label: "Kirjattu, tarkistettava", tone: "warn" },
  unmatched: { label: "Käsiteltävä", tone: "alert" },
  handled: { label: "Käsitelty", tone: "neutral" },
  ignored: { label: "Ohitettu", tone: "neutral" },
};

export async function loadSms(tx: Sql, orgId: string) {
  const [org] = await tx.query<{ sms_number: string | null }>("select sms_number from ml_organizations where id = $1", [orgId]);
  const rows = await tx.query<{
    id: string; from_phone: string; body: string; received_at: string; status: string; reason: string | null;
    customer_id: string | null; customer_name: string | null; property_id: string | null; street_address: string | null; reply: string | null;
  }>(
    `select s.id, s.from_phone, s.body, s.received_at, s.status, s.reason, s.customer_id, c.name as customer_name,
            s.property_id, p.street_address, s.reply
       from ml_inbound_sms s
       left join ml_customers c on c.id = s.customer_id
       left join ml_properties p on p.id = s.property_id
      where s.organization_id = $1
      order by (s.status = 'unmatched') desc, s.received_at desc
      limit 200`,
    [orgId],
  );
  return { smsNumber: org?.sms_number ?? null, rows };
}

/** Tekstiviestit-välilehti: saapuneet viestit ja käsiteltävät. */
export function SmsList({ data, canManage }: { data: Awaited<ReturnType<typeof loadSms>>; canManage: boolean }) {
  const devTools = process.env.NODE_ENV !== "production" && canManage;
  return (
    <>
      {!data.smsNumber ? (
        <div className="mb-5">
          <Notice tone="warn" title="Laitoksen tekstiviestinumeroa ei ole asetettu">
            Numero asetetaan asetuksissa. Vastaanotto otetaan käyttöön, kun palveluntarjoaja on valittu.
          </Notice>
        </div>
      ) : (
        <p className="mb-4 text-sm text-ink/65">Lukemat numeroon {formatPhone(data.smsNumber)}.</p>
      )}
      {data.rows.length === 0 ? (
        <EmptyState title="Ei tekstiviestejä" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Saapunut</Th>
              <Th>Lähettäjä</Th>
              <Th>Viesti</Th>
              <Th>Tila</Th>
              {canManage ? <Th /> : null}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((s) => (
              <tr key={s.id}>
                <Td className="tabular whitespace-nowrap">{formatDateTime(s.received_at)}</Td>
                <Td>
                  {s.customer_id ? (
                    <Link href={`/asiakkaat/${s.customer_id}`} className="font-semibold hover:text-sky">
                      {s.customer_name}
                    </Link>
                  ) : null}
                  <span className="block text-xs text-ink/55">{formatPhone(s.from_phone)}</span>
                </Td>
                <Td className="max-w-md">
                  <span className="whitespace-pre-line">{s.body}</span>
                  {s.property_id ? (
                    <Link href={`/kiinteistot/${s.property_id}`} className="mt-1 block text-xs font-semibold text-sky">
                      {s.street_address}
                    </Link>
                  ) : null}
                </Td>
                <Td>
                  <Badge tone={STATUS[s.status]?.tone ?? "neutral"}>{STATUS[s.status]?.label ?? s.status}</Badge>
                  {s.reason ? <span className="mt-1 block text-xs text-ink/60">{s.reason}</span> : null}
                </Td>
                {canManage ? (
                  <Td className="text-right">
                    {s.status === "unmatched" ? (
                      <form action={markSmsHandledAction}>
                        <input type="hidden" name="smsId" value={s.id} />
                        <button className="text-sm font-semibold text-sky" title="Lukema on kirjattu käsin kiinteistön sivulla tai viesti ei vaadi toimia">
                          Käsitelty
                        </button>
                      </form>
                    ) : null}
                  </Td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {devTools ? (
        <Panel className="mt-8 max-w-2xl">
          <h3 className="font-semibold">Simuloi saapuva viesti</h3>
          <p className="mt-1 text-sm text-ink/65">Vain kehitysympäristössä. Viesti käsitellään kuin se olisi tullut laitoksen numeroon.</p>
          <form action={simulateSmsAction} className="mt-4 grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)_auto] sm:items-end">
            <Field label="Lähettäjä" htmlFor="sim-from">
              <Input id="sim-from" name="from" placeholder="040 123 4567" required />
            </Field>
            <Field label="Viesti" htmlFor="sim-body">
              <Input id="sim-body" name="body" placeholder="Lukema 1234" required />
            </Field>
            <Button variant="secondary">Lähetä</Button>
          </form>
        </Panel>
      ) : null}
    </>
  );
}
