import Link from "next/link";
import { notFound } from "next/navigation";
import { NavIcon } from "@/components/NavIcon";
import { HELP_TOPICS, helpTopic, sectionId } from "@/lib/help/topics";

export function generateStaticParams() {
  return HELP_TOPICS.map((t) => ({ aihe: t.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ aihe: string }> }) {
  const t = helpTopic((await params).aihe);
  return { title: t ? `Ohje: ${t.title}` : "Ohjeet" };
}

export default async function HelpTopicPage({ params }: { params: Promise<{ aihe: string }> }) {
  const t = helpTopic((await params).aihe);
  if (!t) notFound();
  const related = (t.related ?? []).map(helpTopic).filter((r) => r !== null);

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_16rem]">
      <article className="max-w-3xl">
        <Link href="/ohjeet" className="text-sm font-semibold text-sky hover:underline">
          ← Kaikki toiminnot
        </Link>
        <div className="mt-4 flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-sky-soft text-sky">
            <NavIcon name={t.icon} size={24} />
          </span>
          <p className="text-sm font-semibold uppercase tracking-wide text-ink/55">{t.group}</p>
        </div>
        <h1 className="mt-3 text-3xl">{t.title}</h1>
        {t.upcoming ? (
          <p className="mt-3 inline-block rounded-full border border-amber/25 bg-amber-soft px-3 py-1 text-sm font-semibold text-amber">Kehitteillä</p>
        ) : null}
        <p className="mt-4 text-lg text-ink/75">{t.summary}</p>

        <ul className="mt-6 grid gap-2 rounded-[var(--radius-panel)] border border-line bg-paper p-5 text-sm">
          {t.highlights.map((h) => (
            <li key={h} className="flex gap-2">
              <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-moss" />
              <span>{h}</span>
            </li>
          ))}
        </ul>

        {t.sections.map((s) => (
          <section key={s.title} id={sectionId(s.title)} className="mt-10 scroll-mt-6">
            <h2 className="text-xl">{s.title}</h2>
            {s.text ? <p className="mt-3 leading-relaxed text-ink/80">{s.text}</p> : null}
            {s.steps ? (
              <ol className="mt-4 grid gap-3">
                {s.steps.map((step, i) => (
                  <li key={step} className="flex gap-3">
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-ink text-sm font-bold text-paper">{i + 1}</span>
                    <span className="pt-0.5 leading-relaxed">{step}</span>
                  </li>
                ))}
              </ol>
            ) : null}
            {s.bullets ? (
              <ul className="mt-4 grid gap-2">
                {s.bullets.map((b) => (
                  <li key={b} className="flex gap-2 leading-relaxed">
                    <span aria-hidden="true" className="mt-2.5 size-1.5 shrink-0 rounded-full bg-sky" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}

        {t.tips?.length ? (
          <section className="mt-10 rounded-[var(--radius-panel)] border border-sky/20 bg-sky-soft p-5">
            <h2 className="text-lg">Hyvä tietää</h2>
            <ul className="mt-3 grid gap-2 text-sm">
              {t.tips.map((tip) => (
                <li key={tip} className="leading-relaxed">
                  {tip}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </article>

      <aside className="grid content-start gap-4">
        {t.appPath ? (
          <div className="rounded-[var(--radius-panel)] border border-line bg-paper p-5">
            <p className="text-sm text-ink/60">Sovelluksessa</p>
            <Link href={t.appPath} className="mt-1 block font-semibold text-sky hover:underline">
              Avaa {t.appLabel} →
            </Link>
          </div>
        ) : null}
        {t.slug !== "kehitystoiveet" ? (
          <div className="rounded-[var(--radius-panel)] border border-line bg-paper p-5">
            <p className="text-sm text-ink/60">Puuttuuko jotain?</p>
            <Link href={`/kehitystoiveet/uusi?toiminto=${t.slug}`} className="mt-1 block font-semibold text-sky hover:underline">
              Anna kehitystoive →
            </Link>
          </div>
        ) : null}
        {related.length ? (
          <div className="rounded-[var(--radius-panel)] border border-line bg-paper p-5">
            <p className="text-sm text-ink/60">Katso myös</p>
            <ul className="mt-2 grid gap-2">
              {related.map((r) => (
                <li key={r.slug}>
                  <Link href={`/ohjeet/${r.slug}`} className="font-semibold hover:text-sky">
                    {r.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
