import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState, PageHeader, Panel, SectionTitle, Tabs } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { formatDate, isoDateHelsinki } from "@/lib/format";
import { buildTimeline, loadTimeline, type Lane, type TimelineCategory } from "@/lib/registry/timeline";

export const metadata = { title: "Aikajana" };

const FILTERS: { key: string; label: string; categories: TimelineCategory[] }[] = [
  { key: "kaikki", label: "Kaikki", categories: ["event", "contract", "meter", "reading", "invoice"] },
  { key: "osapuolet", label: "Osapuolet", categories: ["event", "contract"] },
  { key: "mittarit", label: "Mittarit ja lukemat", categories: ["event", "meter", "reading"] },
  { key: "laskut", label: "Laskut", categories: ["invoice"] },
];
const DOT: Record<string, string> = {
  neutral: "bg-ink/35", info: "bg-sky", ok: "bg-moss", warn: "bg-amber", alert: "bg-coral",
};
const CATEGORY_LABEL: Record<TimelineCategory, string> = { event: "Tapahtuma", contract: "Sopimus", meter: "Mittari", reading: "Lukema", invoice: "Lasku" };

const toDay = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;

/** Kaistat: kuka oli osapuolena ja mikä mittari käytössä milloinkin. Janan alku on varhaisin alkupäivä. */
function Lanes({ lanes, today }: { lanes: Lane[]; today: string }) {
  const starts = lanes.flatMap((l) => l.segments.map((s) => s.from)).sort();
  if (!starts.length) return null;
  const min = toDay(starts[0]);
  const max = toDay(today);
  const span = Math.max(1, max - min);
  const pos = (iso: string) => `${((Math.min(toDay(iso), max) - min) / span) * 100}%`;
  const firstYear = Number(starts[0].slice(0, 4)) + 1;
  const lastYear = Number(today.slice(0, 4));
  const step = Math.max(1, Math.ceil((lastYear - firstYear + 1) / 8));
  const years = [];
  for (let y = firstYear; y <= lastYear; y += step) years.push(y);
  const colors = ["bg-sky", "bg-moss", "bg-amber", "bg-coral", "bg-ink/60"];

  return (
    <div className="grid gap-3">
      {lanes.map((l) => (
        <div key={l.key} className="grid items-center gap-2 sm:grid-cols-[9rem_1fr]">
          <p className="text-sm font-semibold text-ink/70">{l.label}</p>
          <div className="relative h-8 rounded-lg bg-cloud">
            {l.segments.length === 0 ? <span className="absolute inset-0 grid place-items-center text-xs text-ink/45">ei koskaan</span> : null}
            {l.segments.map((s, i) => {
              const left = pos(s.from);
              const width = `calc(${pos(s.to ?? today)} - ${left})`;
              const title = `${s.label}: ${formatDate(s.from)} – ${s.to ? formatDate(s.to) : "voimassa"}`;
              const cls = `absolute top-1 bottom-1 min-w-1 overflow-hidden rounded-md px-1.5 text-xs leading-6 text-paper ${colors[i % colors.length]}`;
              return s.href ? (
                <Link key={i} href={s.href} title={title} className={`${cls} hover:opacity-85`} style={{ left, width }}>
                  <span className="truncate">{s.label}</span>
                </Link>
              ) : (
                <span key={i} title={title} className={cls} style={{ left, width }}>
                  <span className="truncate">{s.label}</span>
                </span>
              );
            })}
          </div>
        </div>
      ))}
      <div className="grid gap-2 sm:grid-cols-[9rem_1fr]">
        <span />
        <div className="relative h-4 text-xs text-ink/50">
          {years.map((y) => (
            <span key={y} className="absolute -translate-x-1/2 tabular" style={{ left: pos(`${y}-01-01`) }}>
              {y}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default async function TimelinePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ nayta?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireStaff();
  const data = await ctx.run(async (tx) => {
    const t = await loadTimeline(tx, ctx.org.organizationId, id);
    if (!t) return null;
    const [p] = await tx.query<{ street_address: string }>("select street_address from ml_properties where id = $1", [id]);
    return { t, address: p.street_address };
  });
  if (!data) notFound();
  const today = isoDateHelsinki();
  const { entries, lanes } = buildTimeline(data.t);
  const filter = FILTERS.find((f) => f.key === sp.nayta) ?? FILTERS[0];
  const shown = entries.filter((e) => filter.categories.includes(e.category));
  const years = [...new Set(shown.map((e) => e.date.slice(0, 4)))];
  const back = `/kiinteistot/${id}`;

  return (
    <>
      <PageHeader title="Aikajana" subtitle={data.address} back={{ href: back, label: data.address }} />
      <Panel>
        <SectionTitle>Osapuolet ja mittarit ajassa</SectionTitle>
        <Lanes lanes={lanes} today={today} />
      </Panel>

      <section className="mt-8">
        <Tabs active={filter.key} items={FILTERS.map((f) => ({ key: f.key, label: f.label, href: `${back}/aikajana${f.key === "kaikki" ? "" : `?nayta=${f.key}`}` }))} />
        {shown.length === 0 ? (
          <EmptyState title="Ei merkintöjä" />
        ) : (
          years.map((y) => (
            <div key={y} className="mb-8">
              <h2 className="mb-3 text-lg tabular">{y}</h2>
              <ol className="relative grid gap-0 border-l border-line pl-6">
                {shown
                  .filter((e) => e.date.startsWith(y))
                  .map((e, i) => (
                    <li key={`${e.date}-${i}`} className="relative py-2.5">
                      <span aria-hidden="true" className={`absolute -left-[1.72rem] top-4 size-2.5 rounded-full ring-4 ring-cloud ${DOT[e.tone]}`} />
                      <div className="flex flex-wrap items-baseline gap-x-3">
                        <span className="w-20 shrink-0 text-sm tabular text-ink/55">{formatDate(e.date)}</span>
                        <span className="text-xs font-semibold uppercase tracking-wide text-ink/45">{CATEGORY_LABEL[e.category]}</span>
                        {e.href ? (
                          <Link href={e.href} className={`${e.category === "event" ? "font-bold" : "font-semibold"} hover:text-sky`}>
                            {e.title}
                          </Link>
                        ) : (
                          <span className={e.category === "event" ? "font-bold" : "font-semibold"}>{e.title}</span>
                        )}
                      </div>
                      {e.detail ? <p className="mt-0.5 pl-0 text-sm text-ink/65 sm:pl-[5.75rem]">{e.detail}</p> : null}
                    </li>
                  ))}
              </ol>
            </div>
          ))
        )}
      </section>
    </>
  );
}
