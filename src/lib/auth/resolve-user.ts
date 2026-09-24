import type { Sql } from "@/lib/db/types";
import type { SessionIdentity } from "./session";

export interface UserRow {
  id: string;
  email: string;
  full_name: string | null;
}

/**
 * Kirjautuneen tunnisteen (`sub`) käyttäjärivi. Ajetaan palvelun roolilla.
 *
 * Jos tunnistetta ei löydy mutta Auth0 on varmentanut sähköpostin, rivi
 * yhdistetään samalla osoitteella olevaan käyttäjään. Näin toimii sekä
 * pääkäyttäjän esilisäys (`npm run kayttaja:lisaa`) että siirto toiseen
 * Auth0-tenanttiin, jossa tunnisteet vaihtuvat (DECISIONS 25.9.2026).
 * Varmentamatonta osoitetta ei yhdistetä: silloin kuka tahansa voisi ottaa
 * toisen tunnuksen haltuunsa rekisteröimällä saman osoitteen.
 */
export async function resolveUser(tx: Sql, identity: SessionIdentity): Promise<UserRow | null> {
  const [bySub] = await tx.query<UserRow>("select id, email, full_name from ml_users where auth_sub = $1", [identity.sub]);
  if (bySub) return bySub;
  if (!identity.email) return null;

  const [byEmail] = await tx.query<UserRow>("select id, email, full_name from ml_users where lower(email) = lower($1)", [identity.email]);
  if (byEmail) {
    if (!identity.emailVerified) return null;
    await tx.query("update ml_users set auth_sub = $2 where id = $1", [byEmail.id, identity.sub]);
    await tx.query(
      "insert into ml_audit_log (user_id, action, entity, entity_id, details) values ($1, 'user.relink', 'ml_users', $1, $2)",
      [byEmail.id, JSON.stringify({ provider: identity.sub.split("|")[0] })],
    );
    return byEmail;
  }

  const [created] = await tx.query<UserRow>("insert into ml_users (auth_sub, email) values ($1, $2) returning id, email, full_name", [
    identity.sub,
    identity.email,
  ]);
  return created;
}
