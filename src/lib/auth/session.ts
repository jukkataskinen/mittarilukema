import "server-only";
import { cookies } from "next/headers";
import { verifySignedValue } from "@/lib/security/crypto";

/**
 * Kirjautumisen tunniste (`sub`). Kaksi tilaa kuten eRapussa:
 *
 * - `AUTH_MODE=auth0`: Auth0-tenant (BLOCKERS 6: oma vai eRapun tenant).
 * - `AUTH_MODE=dev`: kehityskirjautuminen, jossa käyttäjä valitaan listasta.
 *   Estetty tuotannossa kokonaan, vaikka muuttuja olisi asetettu väärin.
 *   Poikkeus: Vercelin esikatselu, jos ALLOW_PREVIEW_DEV_LOGIN=1 (esikatselut
 *   ovat Vercel-kirjautumisen takana).
 */
export const DEV_SESSION_COOKIE = "ml_dev_session";

export function authMode(): "auth0" | "dev" {
  return process.env.AUTH_MODE === "auth0" ? "auth0" : "dev";
}

export function devLoginAllowed(): boolean {
  if (authMode() !== "dev") return false;
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.VERCEL_ENV === "preview" && process.env.ALLOW_PREVIEW_DEV_LOGIN === "1";
}

export interface SessionIdentity {
  sub: string;
  email: string | null;
}

export async function getSessionIdentity(): Promise<SessionIdentity | null> {
  if (authMode() === "auth0") {
    const { auth0 } = await import("./auth0");
    const session = await auth0.getSession();
    const sub = session?.user?.sub;
    if (!sub) return null;
    return { sub, email: typeof session.user.email === "string" ? session.user.email : null };
  }
  if (!devLoginAllowed()) return null;
  const sub = verifySignedValue((await cookies()).get(DEV_SESSION_COOKIE)?.value);
  return sub ? { sub, email: null } : null;
}
