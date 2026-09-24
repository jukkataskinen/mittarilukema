import type { Database, Sql } from "@/lib/db/types";
import { audit } from "@/lib/audit";

export type MemberRole = "owner" | "staff" | "reader";

export class MemberError extends Error {}

/**
 * Käyttäjän lisäys organisaatioon sähköpostilla ennen ensimmäistä
 * kirjautumista. Käyttäjärivi luodaan palvelun roolilla tunnisteella
 * `pending|<sähköposti>`, koska kirjautumaton käyttäjä ei ole vielä minkään
 * organisaation jäsen eikä RLS salli rivin luontia. Tunniste vaihtuu
 * ensimmäisellä kirjautumisella, kun Auth0 on varmentanut saman osoitteen
 * (src/lib/auth/resolve-user.ts). Jäsenyys luodaan pääkäyttäjän omassa
 * RLS-transaktiossa, joten vain pääkäyttäjä voi lisätä jäseniä.
 */
export async function addMember(
  db: Database,
  actorSub: string,
  input: { organizationId: string; actorId: string; email: string; fullName: string | null; role: MemberRole },
): Promise<{ userId: string; created: boolean }> {
  const email = input.email.trim().toLowerCase();
  // Oikeus tarkistetaan ennen käyttäjärivin luontia, jottei kantaan jää orpoja rivejä.
  const [{ ok }] = await db.asUser(actorSub, (tx) =>
    tx.query<{ ok: boolean }>("select ml_has_org_role($1, array['owner']) as ok", [input.organizationId]),
  );
  if (!ok) throw new MemberError("Vain pääkäyttäjä voi lisätä käyttäjiä.");
  const { id: userId, created } = await db.asService(async (tx) => {
    const [existing] = await tx.query<{ id: string }>("select id from ml_users where lower(email) = $1", [email]);
    if (existing) return { id: existing.id, created: false };
    const [row] = await tx.query<{ id: string }>("insert into ml_users (auth_sub, email, full_name) values ($1, $2, $3) returning id", [
      `pending|${email}`,
      email,
      input.fullName,
    ]);
    return { id: row.id, created: true };
  });
  await db.asUser(actorSub, async (tx) => {
    const rows = await tx.query(
      `insert into ml_org_members (organization_id, user_id, role) values ($1, $2, $3)
       on conflict (organization_id, user_id) do nothing returning user_id`,
      [input.organizationId, userId, input.role],
    );
    if (rows.length === 0) throw new MemberError("Käyttäjä on jo tämän organisaation jäsen.");
    await audit(tx, {
      organizationId: input.organizationId, userId: input.actorId, action: "member.add", entity: "ml_org_members", entityId: userId,
      details: { role: input.role, newUser: created },
    });
  });
  return { userId, created };
}

async function ownerCount(tx: Sql, orgId: string): Promise<number> {
  const [row] = await tx.query<{ n: number }>("select count(*)::int as n from ml_org_members where organization_id = $1 and role = 'owner'", [orgId]);
  return row.n;
}

export async function changeMemberRole(tx: Sql, input: { organizationId: string; actorId: string; userId: string; role: MemberRole }): Promise<void> {
  const [current] = await tx.query<{ role: MemberRole }>("select role from ml_org_members where organization_id = $1 and user_id = $2", [
    input.organizationId,
    input.userId,
  ]);
  if (!current) throw new MemberError("Käyttäjää ei löytynyt.");
  if (current.role === "owner" && input.role !== "owner" && (await ownerCount(tx, input.organizationId)) <= 1) {
    throw new MemberError("Organisaatiolla on oltava vähintään yksi pääkäyttäjä.");
  }
  const rows = await tx.query("update ml_org_members set role = $3 where organization_id = $1 and user_id = $2 returning user_id", [
    input.organizationId,
    input.userId,
    input.role,
  ]);
  if (rows.length === 0) throw new MemberError("Vain pääkäyttäjä voi muuttaa rooleja.");
  await audit(tx, { organizationId: input.organizationId, userId: input.actorId, action: "member.role", entity: "ml_org_members", entityId: input.userId, details: { role: input.role } });
}

export async function removeMember(tx: Sql, input: { organizationId: string; actorId: string; userId: string }): Promise<void> {
  if (input.userId === input.actorId) throw new MemberError("Et voi poistaa itseäsi.");
  const [current] = await tx.query<{ role: MemberRole }>("select role from ml_org_members where organization_id = $1 and user_id = $2", [
    input.organizationId,
    input.userId,
  ]);
  if (!current) throw new MemberError("Käyttäjää ei löytynyt.");
  if (current.role === "owner" && (await ownerCount(tx, input.organizationId)) <= 1) {
    throw new MemberError("Organisaatiolla on oltava vähintään yksi pääkäyttäjä.");
  }
  const rows = await tx.query("delete from ml_org_members where organization_id = $1 and user_id = $2 returning user_id", [input.organizationId, input.userId]);
  if (rows.length === 0) throw new MemberError("Vain pääkäyttäjä voi poistaa käyttäjiä.");
  await audit(tx, { organizationId: input.organizationId, userId: input.actorId, action: "member.remove", entity: "ml_org_members", entityId: input.userId });
}
