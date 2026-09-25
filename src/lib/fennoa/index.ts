/**
 * Fennoa-rajapinta. Tilat (FENNOA_MODE):
 *   mock  oletus: mitään ei lähetetä, laskut "luodaan" muistiin (kehitys ja testit)
 *   test  Fennoan testiyritys tunnuksilla FENNOA_TEST_API_USER ja FENNOA_TEST_API_KEY
 * Tuotantoon vientiä ei ole otettu käyttöön: se päätetään erikseen, koska
 * Fennoan tuotantoon luotuja laskuja ei voi poistaa (DECISIONS 24.9.2026).
 */

const API_URL = "https://app.fennoa.com/api/";

export type FennoaEnvironment = "mock" | "test";

export interface FennoaReadBack {
  deliveryMethod: string | null;
  gross: number | null;
  /** Vastauksen toimitustapaan liittyvät kentät (nimi=arvo) poikkeaman selvittämiseen; ei osoitteita. */
  deliveryFields?: string[];
}

export interface FennoaClient {
  environment: FennoaEnvironment;
  /** Luo laskuluonnoksen (sales_api/add). Palauttaa Fennoan laskutunnuksen. */
  addInvoice(form: Record<string, string>): Promise<{ id: string }>;
  /** Lukee laskun takaisin (GET sales_api/<id>) laskukanavan ja summan tarkistusta varten. */
  getInvoice(id: string): Promise<FennoaReadBack>;
}

export class FennoaError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

/** Mock: tallentaa luodut laskut muistiin ja palauttaa niiden kanavan ja summan sellaisenaan. */
export function mockFennoa(): FennoaClient & { invoices: Map<string, Record<string, string>> } {
  const invoices = new Map<string, Record<string, string>>();
  return {
    environment: "mock",
    invoices,
    async addInvoice(form) {
      const id = `mock-${invoices.size + 1}`;
      invoices.set(id, form);
      return { id };
    },
    async getInvoice(id) {
      const f = invoices.get(id);
      if (!f) throw new FennoaError("Laskua ei löytynyt.", 404);
      return { deliveryMethod: f.delivery_method ?? null, gross: grossOf(f) };
    },
  };
}

/** Rivien summa lomakkeelta (mock laskee sen kuten Fennoa: määrä × hinta, verollinen tai veroton). */
function grossOf(f: Record<string, string>): number {
  let total = 0;
  for (let n = 1; f[`row[${n}][name]`] !== undefined; n++) {
    const line = Math.round(Number(f[`row[${n}][quantity]`]) * Number(f[`row[${n}][price]`]) * 100) / 100;
    total += f.include_vat === "1" ? line : line * (1 + Number(f[`row[${n}][vatpercent]`]) / 100);
  }
  return Math.round(total * 100) / 100;
}

function httpClient(user: string, key: string): FennoaClient {
  const auth = `Basic ${Buffer.from(`${user}:${key}`).toString("base64")}`;
  const call = async (method: "GET" | "POST", path: string, form?: Record<string, string>) => {
    const res = await fetch(API_URL + path, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: auth,
        ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      body: form ? new URLSearchParams(form) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // Fennoa ei aina palauta JSONia.
    }
    if (!res.ok || (body as { status?: string } | null)?.status === "ERROR") {
      if (res.status === 401 || res.status === 403) throw new FennoaError("Fennoa hylkäsi tunnukset. Tarkista testiyrityksen API-tunnus ja -avain.", res.status);
      // Fennoan virheteksti kertoo kentän, ei henkilötietoja.
      const b = body as { message?: unknown; error?: unknown; errors?: unknown } | null;
      const msg = b?.message ?? b?.error ?? b?.errors ?? `HTTP ${res.status}`;
      throw new FennoaError(`Fennoa: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`.slice(0, 300), res.status);
    }
    return body;
  };
  return {
    environment: "test",
    async addInvoice(form) {
      const body = (await call("POST", "sales_api/add", form)) as { id?: unknown; data?: { id?: unknown } } | null;
      // Kasamaster: Fennoa palauttaa tunnuksen kentässä "id".
      const id = body?.id ?? body?.data?.id;
      if (id === undefined || id === null) throw new FennoaError("Fennoa ei palauttanut laskutunnusta.", null);
      return { id: String(id) };
    },
    async getInvoice(id) {
      const body = await call("GET", `sales_api/${encodeURIComponent(id)}`);
      return {
        deliveryMethod: findKey(body, "delivery_method"),
        gross: toNumber(findKey(body, "total_gross") ?? findKey(body, "gross_total") ?? findKey(body, "total_sum")),
        deliveryFields: deliveryFields(body),
      };
    },
  };
}

/**
 * Toimitustapaan liittyvät kentät vastauksesta (avaimessa "deliver"), jotta poikkeamasta
 * nähdään, mitä Fennoa tallensi. Osoite- ja verkkolaskuosoitekentät jätetään pois.
 */
function deliveryFields(obj: unknown, depth = 0, prefix = ""): string[] {
  if (!obj || typeof obj !== "object" || depth > 4) return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (/address|osoite|email|bic/i.test(k)) continue;
    if (v && typeof v === "object") out.push(...deliveryFields(v, depth + 1, key));
    else if (/deliver/i.test(k) && v !== null && v !== "") out.push(`${key}=${String(v).slice(0, 40)}`);
  }
  return out.slice(0, 8);
}

/** Kentän arvo vastauksesta syvyydestä riippumatta (vastauksen kääre ei ole dokumentoitu). */
function findKey(obj: unknown, key: string, depth = 0): string | null {
  if (!obj || typeof obj !== "object" || depth > 4) return null;
  const rec = obj as Record<string, unknown>;
  if (rec[key] !== undefined && rec[key] !== null && typeof rec[key] !== "object") return String(rec[key]);
  for (const v of Object.values(rec)) {
    const hit = findKey(v, key, depth + 1);
    if (hit !== null) return hit;
  }
  return null;
}

const toNumber = (v: string | null) => (v === null || Number.isNaN(Number(v)) ? null : Number(v));

export function fennoaClient(): FennoaClient {
  const mode = process.env.FENNOA_MODE ?? "mock";
  if (mode === "mock") return mockFennoa();
  if (mode === "test") {
    const user = process.env.FENNOA_TEST_API_USER;
    const key = process.env.FENNOA_TEST_API_KEY;
    if (!user || !key) throw new FennoaError("Fennoan testiyrityksen tunnukset puuttuvat (FENNOA_TEST_API_USER, FENNOA_TEST_API_KEY).", null);
    return httpClient(user, key);
  }
  throw new FennoaError(`Fennoa-tilaa "${mode}" ei ole käytössä. Tuotantoon vienti otetaan käyttöön erillisellä päätöksellä.`, null);
}

/** Käytössä oleva ympäristö näkymiä varten luomatta asiakasta (null = ei sallittu tila). */
export function fennoaEnvironment(): FennoaEnvironment | null {
  const mode = process.env.FENNOA_MODE ?? "mock";
  return mode === "mock" || mode === "test" ? mode : null;
}
