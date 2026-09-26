"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { emailSender } from "@/lib/email";
import { isoDateHelsinki } from "@/lib/format";
import { sha256Hex } from "@/lib/security/crypto";
import {
  CHANGE_KINDS, ChangeRequestError, KIND_SHORT, KIND_SLUG, orgByFormToken, parseChangeRequest, submitChangeRequest, type ChangeKind,
} from "@/lib/change-requests";

/** Julkinen muutosilmoitus. Ei kirjautumista; organisaatio tunnistetaan lomakkeen tunnuksesta. */
export async function submitChangeRequestAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  if (!/^[0-9a-f]{32}$/.test(token)) redirect("/");
  const kind = String(formData.get("kind") ?? "") as ChangeKind;
  if (!CHANGE_KINDS.includes(kind)) redirect(`/ilmoitus/${token}`);
  const back = `/ilmoitus/${token}?laji=${KIND_SLUG[kind]}`;
  const fail = (msg: string): never => redirect(`${back}&virhe=${encodeURIComponent(msg)}`);

  // Ansakenttä: ihminen ei näe kenttää, joten täytetty kenttä on lähes varmasti robotti.
  // Robotille näytetään sama kiitos, jottei se opi kiertämään tarkistusta.
  if (String(formData.get("website") ?? "") !== "") redirect(`/ilmoitus/${token}?kiitos=1`);

  const db = await getDb();
  const org = await orgByFormToken(db, token);
  if (!org) redirect("/");
  const parsed = parseChangeRequest(kind, (n) => formData.get(n), isoDateHelsinki());
  if (typeof parsed === "string") fail(parsed);

  // IP-osoitetta ei tallenneta, vain suolattu tiiviste lähetysmäärien rajaamiseen.
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "";
  const ipHash = ip ? sha256Hex(`${ip}|${process.env.FIELD_ENCRYPTION_KEY ?? "dev"}`) : null;

  let id = "";
  try {
    id = await submitChangeRequest(db, org!.id, parsed as Exclude<typeof parsed, string>, ipHash);
  } catch (err) {
    if (err instanceof ChangeRequestError) fail(err.message);
    throw err;
  }

  // Ilmoitus toimistolle: vain laji ja linkki, ei henkilötietoja sähköpostiin.
  if (org!.contact_email) {
    try {
      const base = process.env.APP_BASE_URL?.replace(/\/$/, "") ?? "";
      const link = `${base}/muutosilmoitukset/${id}`;
      await emailSender().send({
        to: org!.contact_email,
        subject: `Uusi muutosilmoitus: ${KIND_SHORT[kind]}`,
        text: `Mittarilukemaan on tullut uusi muutosilmoitus (${KIND_SHORT[kind].toLowerCase()}).\n\nAvaa ilmoitus: ${link}\n`,
        html: `<p>Mittarilukemaan on tullut uusi muutosilmoitus (${KIND_SHORT[kind].toLowerCase()}).</p><p><a href="${link}">Avaa ilmoitus</a></p>`,
        fromName: "Mittarilukema",
      });
    } catch {
      // Ilmoitus on tallennettu; sähköpostin epäonnistuminen ei saa estää asiakkaan ilmoitusta.
    }
  }
  redirect(`/ilmoitus/${token}?kiitos=1`);
}
