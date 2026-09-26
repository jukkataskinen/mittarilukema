import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, DefinitionList, Field, Notice, PageHeader, Panel, SectionTitle, Select, Textarea } from "@/components/ui";
import { FormError } from "@/components/FormError";
import { requireStaff } from "@/lib/auth/current-user";
import { formatDateTime } from "@/lib/format";
import { featureLabel, IMPORTANCE_LABEL, REQUEST_STATUS } from "@/lib/feature-requests";
import { helpTopic } from "@/lib/help/topics";
import { updateFeatureRequestAction } from "../actions";

export const metadata = { title: "Kehitystoive" };

export default async function FeatureRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ virhe?: string; kiitos?: string; tallennettu?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireStaff();
  const [r] = await ctx.run((tx) =>
    tx.query<{
      id: string; feature: string; page_path: string | null; title: string; description: string; importance: string; status: string; response: string | null;
      created_at: string; handled_at: string | null; author: string; handler: string | null;
    }>(
      `select r.id, r.feature, r.page_path, r.title, r.description, r.importance, r.status, r.response, r.created_at, r.handled_at,
              coalesce(u.full_name, u.email) as author, coalesce(h.full_name, h.email) as handler
         from ml_feature_requests r join ml_users u on u.id = r.created_by left join ml_users h on h.id = r.handled_by
        where r.organization_id = $1 and r.id = $2`,
      [ctx.org.organizationId, id],
    ),
  );
  if (!r) notFound();
  const st = REQUEST_STATUS[r.status];
  const topic = helpTopic(r.feature);

  return (
    <div className="max-w-3xl">
      <PageHeader title={r.title} subtitle={featureLabel(r.feature)} back={{ href: "/kehitystoiveet", label: "Kehitystoiveet" }} actions={<Badge tone={st.tone}>{st.label}</Badge>} />
      <FormError message={sp.virhe} />
      {sp.kiitos ? (
        <div className="mb-5">
          <Notice tone="ok" title="Kiitos, toive on tallennettu." />
        </div>
      ) : null}
      {sp.tallennettu ? (
        <div className="mb-5">
          <Notice tone="ok" title="Tila tallennettu." />
        </div>
      ) : null}
      <Panel>
        <p className="whitespace-pre-line leading-relaxed">{r.description}</p>
        <div className="mt-5 border-t border-line pt-4">
          <DefinitionList
            items={[
              { label: "Toiminto", value: topic ? <Link href={`/ohjeet/${topic.slug}`} className="text-sky hover:underline">{topic.title}</Link> : featureLabel(r.feature) },
              { label: "Tärkeys", value: IMPORTANCE_LABEL[r.importance] },
              { label: "Jättäjä", value: `${r.author}, ${formatDateTime(r.created_at)}` },
              ...(r.page_path ? [{ label: "Sivu", value: <Link href={r.page_path} className="text-sky hover:underline">{r.page_path}</Link> }] : []),
            ]}
          />
        </div>
      </Panel>

      {r.response || r.handled_at ? (
        <section className="mt-8">
          <SectionTitle>Vastaus</SectionTitle>
          <Panel>
            {r.response ? <p className="whitespace-pre-line">{r.response}</p> : <p className="text-sm text-ink/60">Ei vastausta.</p>}
            {r.handler ? (
              <p className="mt-2 text-xs text-ink/55">
                {r.handler}
                {r.handled_at ? `, ${formatDateTime(r.handled_at)}` : ""}
              </p>
            ) : null}
          </Panel>
        </section>
      ) : null}

      {ctx.can("owner", "staff") ? (
        <section className="mt-8">
          <SectionTitle>Käsittely</SectionTitle>
          <Panel>
            <form action={updateFeatureRequestAction} className="grid gap-4">
              <input type="hidden" name="requestId" value={r.id} />
              <Field label="Tila" htmlFor="status">
                <Select id="status" name="status" defaultValue={r.status}>
                  {Object.entries(REQUEST_STATUS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Vastaus jättäjälle" htmlFor="response">
                <Textarea id="response" name="response" rows={3} defaultValue={r.response ?? ""} maxLength={5000} />
              </Field>
              <div>
                <Button variant="secondary">Tallenna</Button>
              </div>
            </form>
          </Panel>
        </section>
      ) : null}
    </div>
  );
}
