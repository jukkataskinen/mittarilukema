/**
 * Sähköpostin lähetys. Tilat (EMAIL_MODE):
 *   mock    oletus: viestiä ei lähetetä, vain määrä kirjataan lokiin
 *   resend  Resend (resend.com), avain RESEND_API_KEY ja lähettäjä EMAIL_FROM
 *           (lähettäjän verkkotunnus vahvistettava Resendissä)
 * Vastaanottajan osoitetta ei kirjoiteta lokiin eikä virheviestiin.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Näkyvä lähettäjän nimi, esim. organisaation nimi. */
  fromName: string;
  replyTo?: string | null;
}

export interface EmailSender {
  mode: "mock" | "resend";
  send(message: EmailMessage): Promise<{ id: string | null }>;
}

export class EmailError extends Error {}

export function mockEmail(): EmailSender & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    mode: "mock",
    sent,
    async send(message) {
      sent.push(message);
      console.log(`[sähköposti, testitila] ${message.subject.length} merkin otsikko, ${message.text.length} merkkiä`);
      return { id: null };
    },
  };
}

function resend(apiKey: string, from: string): EmailSender {
  return {
    mode: "resend",
    async send(m) {
      // Lähettäjän nimi organisaatiosta, osoite vahvistetusta verkkotunnuksesta.
      const address = from.match(/<([^>]+)>/)?.[1] ?? from;
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: `${m.fromName.replace(/[<>"]/g, "")} <${address}>`,
          to: [m.to],
          subject: m.subject,
          text: m.text,
          html: m.html,
          ...(m.replyTo ? { reply_to: m.replyTo } : {}),
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
      if (!res.ok) throw new EmailError(`Sähköpostipalvelu hylkäsi viestin (${res.status}${body?.message ? `: ${body.message.slice(0, 120)}` : ""}).`);
      return { id: body?.id ?? null };
    },
  };
}

export function emailSender(): EmailSender {
  const mode = process.env.EMAIL_MODE ?? "mock";
  if (mode === "mock") return mockEmail();
  if (mode === "resend") {
    const key = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!key || !from) throw new EmailError("Sähköpostipalvelun avain tai lähettäjäosoite puuttuu (RESEND_API_KEY, EMAIL_FROM).");
    return resend(key, from);
  }
  throw new EmailError(`Sähköpostitilaa "${mode}" ei ole toteutettu.`);
}

export function emailMode(): "mock" | "resend" | null {
  const mode = process.env.EMAIL_MODE ?? "mock";
  return mode === "mock" || mode === "resend" ? mode : null;
}
