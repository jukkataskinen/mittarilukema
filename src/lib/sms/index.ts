/**
 * Tekstiviestipalvelun rajapinta. Palveluntarjoaja on auki (BLOCKERS 2), joten
 * oletus on testitila: viesti kirjataan lokiin eikä lähde minnekään.
 * Todellinen toteutus lisätään tänne, kun palvelu on valittu.
 */

export interface SmsSender {
  send(to: string, text: string): Promise<{ id: string | null }>;
}

const mockSender: SmsSender = {
  async send(to, text) {
    // Numeroa ei kirjoiteta lokiin kokonaan: se on henkilötieto.
    console.log(`[tekstiviesti, testitila] ${to.slice(0, 6)}… ${text.length} merkkiä`);
    return { id: null };
  },
};

export function smsSender(): SmsSender {
  const mode = process.env.SMS_MODE ?? "mock";
  if (mode === "mock") return mockSender;
  throw new Error(`Tekstiviestipalvelua ${mode} ei ole vielä toteutettu.`);
}
