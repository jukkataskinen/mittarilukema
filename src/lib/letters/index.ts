/**
 * Kirjeiden tulostus- ja postituspalvelu. Tilat (LETTER_MODE):
 *   mock     oletus: mitään ei lähetetä, työ "luodaan" muistiin
 *   postita  Postita.fi (tunnukset POSTITA_USERNAME ja POSTITA_PASSWORD, samat kuin verkkopalvelussa)
 * Postita tulostaa A4-arkit mustavalkoisena isoikkunaiseen C5-kuoreen ja
 * lähettää vahvistetut työt seuraavana arkipäivänä. Kirjeet ladataan
 * vahvistamattomina, jotta vedoksen voi tarkistaa ennen postitusta.
 * Rajapinta: postita.fi/intro/fi/kehittajille/
 */

const API_URL = "https://postita.fi/api/";

export interface LetterJob {
  id: string;
  /** NE = vahvistamaton, CO = vahvistettu, PR = käsittelyssä, SE = lähetetty, CA = peruttu */
  status: string;
  price: number | null;
  recipients: number | null;
}

export interface LetterSender {
  mode: "mock" | "postita";
  /** Lataa PDF:n vahvistamattomana työnä; pagesPerLetter jakaa PDF:n kirjeiksi. */
  upload(input: { jobName: string; pdf: Uint8Array; pagesPerLetter: number; letters: number; postClass: 1 | 2 }): Promise<LetterJob>;
  confirm(jobId: string): Promise<LetterJob>;
  cancel(jobId: string): Promise<void>;
  info(jobId: string): Promise<LetterJob>;
}

export class LetterServiceError extends Error {}

export function mockLetters(): LetterSender & { jobs: Map<string, LetterJob & { pages: number }> } {
  const jobs = new Map<string, LetterJob & { pages: number }>();
  return {
    mode: "mock",
    jobs,
    async upload(input) {
      const id = `mock-${Date.now().toString(36)}-${jobs.size + 1}`;
      const job = { id, status: "NE", price: null, recipients: input.letters, pages: input.pagesPerLetter };
      jobs.set(id, job);
      return job;
    },
    // Testitilan palvelu luodaan joka pyynnössä uudelleen, joten aiemmin ladattu
    // mock-työ tunnistetaan tunnuksesta.
    async confirm(id) {
      const job = jobs.get(id) ?? (id.startsWith("mock-") ? { id, status: "NE", price: null, recipients: null, pages: 0 } : null);
      if (!job) throw new LetterServiceError("Työtä ei löytynyt.");
      job.status = "CO";
      return job;
    },
    async cancel(id) {
      const job = jobs.get(id);
      if (job) job.status = "CA";
    },
    async info(id) {
      const job = jobs.get(id) ?? (id.startsWith("mock-") ? { id, status: "NE", price: null, recipients: null, pages: 0 } : null);
      if (!job) throw new LetterServiceError("Työtä ei löytynyt.");
      return job;
    },
  };
}

const toJob = (r: Record<string, unknown>, fallbackId?: string): LetterJob => ({
  id: String(r.id ?? fallbackId ?? ""),
  status: String(r.status ?? ""),
  price: r.price === undefined || r.price === null ? null : Number(String(r.price).replace(",", ".")),
  recipients: r.recipient_count === undefined ? null : Number(r.recipient_count),
});

function postita(username: string, password: string): LetterSender {
  const auth = `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
  const call = async (path: string, form?: Record<string, string>) => {
    const res = await fetch(API_URL + path, {
      method: form ? "POST" : "GET",
      headers: { Authorization: auth, Accept: "application/json", ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
      body: form ? new URLSearchParams(form) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    if (res.status === 401) throw new LetterServiceError("Postita hylkäsi tunnukset. Tarkista käyttäjätunnus ja salasana.");
    if (res.status === 409) throw new LetterServiceError(`Postita: ${text.slice(0, 200) || "saldo ei riitä tai virheellinen arvo"}.`);
    if (!res.ok) throw new LetterServiceError(`Postita vastasi virheellä ${res.status}.`);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new LetterServiceError("Postitan vastausta ei voitu tulkita.");
    }
  };
  const first = (body: unknown) => (Array.isArray(body) ? body[0] : body) as Record<string, unknown>;
  return {
    mode: "postita",
    async upload({ jobName, pdf, pagesPerLetter, postClass }) {
      // URL-turvallinen base64 täytemerkkeineen (RFC 4648), kuten Postita vaatii.
      const b64 = Buffer.from(pdf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
      const job = toJob(first(await call("send/", { job_name: jobName, pdf: b64, post_class: String(postClass), pdf_splitter: String(pagesPerLetter), confirm: "false" })));
      if (!job.id) throw new LetterServiceError("Postita ei palauttanut työn tunnusta.");
      return job;
    },
    async confirm(id) {
      return toJob(first(await call(`confirm/${encodeURIComponent(id)}/`, {})), id);
    },
    async cancel(id) {
      await call(`delete/${encodeURIComponent(id)}/`, {});
    },
    async info(id) {
      return toJob(first(await call(`job_info/${encodeURIComponent(id)}/`)), id);
    },
  };
}

export function letterSender(): LetterSender {
  const mode = process.env.LETTER_MODE ?? "mock";
  if (mode === "mock") return mockLetters();
  if (mode === "postita") {
    const user = process.env.POSTITA_USERNAME;
    const password = process.env.POSTITA_PASSWORD;
    if (!user || !password) throw new LetterServiceError("Postitan tunnukset puuttuvat (POSTITA_USERNAME, POSTITA_PASSWORD).");
    return postita(user, password);
  }
  throw new LetterServiceError(`Kirjepalvelua "${mode}" ei ole toteutettu.`);
}

export function letterMode(): "mock" | "postita" | null {
  const mode = process.env.LETTER_MODE ?? "mock";
  return mode === "mock" || mode === "postita" ? mode : null;
}
