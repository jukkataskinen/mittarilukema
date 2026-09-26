import Link from "next/link";
import { Badge, EmptyState, LinkButton, PageHeader, Select, Table, Tabs, Td, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { formatDate } from "@/lib/format";
import { featureLabel, featureOptions, IMPORTANCE_LABEL, REQUEST_STATUS } from "@/lib/feature-requests";

export const metadata = { title: "Kehitystoiveet" };

const VIEWS: Record<string, { label: string; statuses: string[] }> = {
  avoimet: { label: "Avoimet", statuses: ["new", "planned", "in_progress"] },
  valmiit: { label: "Tehdyt ja hylätyt", statuses: ["done", "declined"] },
};

export default async function FeatureRequestsPage({ searchParams }: { searchParams: Promise<{ nayta?: string; toiminto?: string }> }) {
  const sp = await searchParams;
  const view = sp.nayta && sp.nayta in VIEWS ? sp.nayta : "avoimet";
  const feature = sp.toiminto && featureOptions().some((f) => f.value === sp.toiminto) ? sp.toiminto : null;
  const ctx = await requireStaff();
  const rows = await ctx.run((tx) =>
    tx.query<{ id: string; feature: string; title: string; importance: string; status: string; created_at: string; author: string }>(
      `select r.id, r.feature, r.title, r.importance, r.status, r.created_at, coalesce(u.full_name, u.email) as author
         from ml_feature_requests r join ml_users u on u.id = r.created_by
        where r.organization_id = $1 and r.status = any($2::text[]) and ($3::text is null or r.feature = $3)
        order by case r.importance when 'blocking' then 0 when 'important' then 1 else 2 end, r.created_at desc`,
      [ctx.org.organizationId, VIEWS[view].statuses, feature],
    ),
  );
  const q = (k: string) => `/kehitystoiveet?nayta=${k}${feature ? `&toiminto=${feature}` : ""}`;

  return (
    <>
      <PageHeader
        title="Kehitystoiveet"
        subtitle="Kerro, mitä toivot ohjelmaan. Voit jättää toiveen myös suoraan toiminnon sivulta."
        actions={<LinkButton href={`/kehitystoiveet/uusi${feature ? `?toiminto=${feature}` : ""}`}>Uusi kehitystoive</LinkButton>}
      />
      <form className="mb-4 flex flex-wrap items-end gap-3" action="/kehitystoiveet">
        <input type="hidden" name="nayta" value={view} />
        <label className="text-sm">
          <span className="mb-1 block font-semibold">Toiminto</span>
          <Select name="toiminto" defaultValue={feature ?? ""}>
            <option value="">Kaikki toiminnot</option>
            {featureOptions().map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Select>
        </label>
        <button className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-sky">Näytä</button>
      </form>
      <Tabs active={view} items={Object.entries(VIEWS).map(([k, v]) => ({ key: k, label: v.label, href: q(k) }))} />
      {rows.length === 0 ? (
        <EmptyState title="Ei toiveita" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Toive</Th>
              <Th>Toiminto</Th>
              <Th>Tärkeys</Th>
              <Th>Jättäjä</Th>
              <Th>Tila</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const st = REQUEST_STATUS[r.status];
              return (
                <tr key={r.id}>
                  <Td>
                    <Link href={`/kehitystoiveet/${r.id}`} className="font-semibold hover:text-sky">
                      {r.title}
                    </Link>
                    <span className="block text-xs text-ink/55">{formatDate(r.created_at)}</span>
                  </Td>
                  <Td>{featureLabel(r.feature)}</Td>
                  <Td className={r.importance === "blocking" ? "font-semibold text-coral" : undefined}>{IMPORTANCE_LABEL[r.importance]}</Td>
                  <Td>{r.author}</Td>
                  <Td>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </>
  );
}
