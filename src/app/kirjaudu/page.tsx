import { redirect } from "next/navigation";
import { Brand } from "@/components/Brand";
import { Button, Notice, Panel } from "@/components/ui";
import { getCurrentUser, ROLE_LABEL, type OrgRole } from "@/lib/auth/current-user";
import { authMode, devLoginAllowed } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { devLogin } from "@/app/actions/session";

export const metadata = { title: "Kirjaudu" };
export const dynamic = "force-dynamic";

// Tavallinen linkki eikä LinkButton: /auth/login on middlewaren reitti, jota Next ei saa esihakea.
const LOGIN_LINK =
  "mt-6 inline-flex min-h-[var(--size-touch)] items-center justify-center rounded-full bg-ink px-5 text-sm font-semibold text-paper hover:bg-ink-strong";

export default async function LoginPage() {
  if (authMode() === "auth0") {
    if (await getCurrentUser()) redirect("/tyopoyta");
    return (
      <div className="mx-auto flex min-h-dvh max-w-[var(--container-content)] flex-col justify-center px-5 py-10">
        <Brand size={30} />
        <h1 className="mt-8 text-3xl">Kirjaudu Mittarilukemaan</h1>
        <p className="mt-2 text-ink/70">Vesihuoltolaitoksen mittarilukemat ja laskutus.</p>
        <a href="/auth/login?ui_locales=fi" className={LOGIN_LINK}>
          Kirjaudu
        </a>
      </div>
    );
  }

  const users = devLoginAllowed()
    ? await (await getDb()).asService((tx) =>
        tx.query<{ id: string; email: string; full_name: string | null; roles: string | null }>(
          `select u.id, u.email, u.full_name,
                  (select string_agg(m.role || ':' || o.name, ', ' order by o.name)
                     from ml_org_members m join ml_organizations o on o.id = m.organization_id
                    where m.user_id = u.id) as roles
             from ml_users u order by u.full_name nulls last, u.email`,
        ),
      )
    : [];

  return (
    <div className="mx-auto flex min-h-dvh max-w-[var(--container-content)] flex-col justify-center px-5 py-10">
      <Brand size={30} />
      <h1 className="mt-8 text-3xl">Kirjaudu Mittarilukemaan</h1>
      <p className="mt-2 text-ink/70">Vesihuoltolaitoksen mittarilukemat ja laskutus.</p>

      {devLoginAllowed() ? (
        <Panel className="mt-8">
          <Notice tone="warn" title="Kehityskirjautuminen">
            Valitse käyttäjä. Tuotannossa kirjautuminen tehdään Auth0:lla, eikä tätä näkymää ole.
          </Notice>
          {users.length === 0 ? (
            <p className="mt-4 text-sm text-ink/70">
              Kannassa ei ole käyttäjiä. Aja <code>npm run db:seed:demo</code>.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-line">
              {users.map((u) => (
                <li key={u.id}>
                  <form action={devLogin} className="flex items-center justify-between gap-3 py-2.5">
                    <input type="hidden" name="userId" value={u.id} />
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{u.full_name ?? u.email}</p>
                      <p className="truncate text-sm text-ink/55">
                        {u.roles
                          ? u.roles
                              .split(", ")
                              .map((r) => {
                                const [role, ...org] = r.split(":");
                                return `${ROLE_LABEL[role as OrgRole] ?? role}, ${org.join(":")}`;
                              })
                              .join(" · ")
                          : u.email}
                      </p>
                    </div>
                    <Button variant="secondary">Kirjaudu</Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : (
        <div className="mt-8">
          <Notice tone="alert" title="Kirjautuminen ei ole vielä käytössä">
            Kirjautumistapaa ei ole määritetty tähän ympäristöön.
          </Notice>
        </div>
      )}
    </div>
  );
}
