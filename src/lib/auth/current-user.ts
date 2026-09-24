import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb, type Database, type Sql } from "@/lib/db";
import { getSessionIdentity } from "./session";
import { resolveUser } from "./resolve-user";
import { signValue, verifySignedValue } from "@/lib/security/crypto";

export type OrgRole = "owner" | "staff" | "reader";

export const ROLE_LABEL: Record<OrgRole, string> = { owner: "Pääkäyttäjä", staff: "Toimisto", reader: "Mittarinlukija" };

export interface Membership {
  organizationId: string;
  organizationName: string;
  role: OrgRole;
}

export interface CurrentUser {
  id: string;
  sub: string;
  email: string;
  fullName: string | null;
  memberships: Membership[];
}

export const ACTIVE_ORG_COOKIE = "ml_org";

/**
 * Kirjautunut käyttäjä ja hänen organisaatioroolinsa. Luetaan palvelun
 * roolilla, koska käyttäjärivi pitää löytää ennen kuin RLS-funktiot voivat
 * tunnistaa hänet. Välimuisti pyynnön ajaksi.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const identity = await getSessionIdentity();
  if (!identity) return null;
  const db = await getDb();

  return db.asService(async (tx) => {
    const user = await resolveUser(tx, identity);
    if (!user) return null;

    const memberships = await tx.query<{ organization_id: string; name: string; role: OrgRole }>(
      `select m.organization_id, o.name, m.role from ml_org_members m
         join ml_organizations o on o.id = m.organization_id
        where m.user_id = $1 order by o.name`,
      [user.id],
    );

    return {
      id: user.id,
      sub: identity.sub,
      email: user.email,
      fullName: user.full_name,
      memberships: memberships.map((m) => ({ organizationId: m.organization_id, organizationName: m.name, role: m.role })),
    };
  });
});

export interface StaffContext {
  db: Database;
  user: CurrentUser;
  org: Membership;
  /** Käyttäjän RLS-transaktio. */
  run<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
  can(...roles: OrgRole[]): boolean;
}

/** Vaatii jäsenyyden jossakin organisaatiossa. Valittu organisaatio evästeestä. */
export const requireStaff = cache(async (): Promise<StaffContext> => {
  const user = await getCurrentUser();
  if (!user) redirect("/kirjaudu");
  if (user.memberships.length === 0) redirect("/ei-oikeutta");

  const selected = verifySignedValue((await cookies()).get(ACTIVE_ORG_COOKIE)?.value);
  const org = user.memberships.find((m) => m.organizationId === selected) ?? user.memberships[0];
  const db = await getDb();
  return {
    db,
    user,
    org,
    run: (fn) => db.asUser(user.sub, fn),
    can: (...roles) => roles.includes(org.role),
  };
});

/** Vaatii jonkin annetuista rooleista; muuten työpöydälle. */
export async function requireRole(...roles: OrgRole[]): Promise<StaffContext> {
  const ctx = await requireStaff();
  if (!ctx.can(...roles)) redirect("/tyopoyta");
  return ctx;
}

export function signedOrgCookie(orgId: string): string {
  return signValue(orgId);
}
