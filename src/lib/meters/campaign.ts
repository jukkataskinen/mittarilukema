import type { Sql } from "@/lib/db/types";
import { audit } from "@/lib/audit";
import { parseReading } from "@/lib/readings/checks";
import { MeterSwapError, normalizeMeterNumber, swapMeter, swapProblem, type SwapMeterState } from "./swap";

/**
 * Etäluettavien mittarien vaihtokampanja: asentajan lista ladataan eräksi,
 * rivit tarkistetaan ja valmiit viedään rekisteriin (0022).
 */

export class CampaignError extends Error {}

/** Tiedoston sarakkeet. Otsikot tunnistetaan väljästi, koska listat tulevat eri asentajilta. */
export type SwapField = "old" | "place" | "date" | "final" | "new" | "start" | "method";
const HEADERS: Record<SwapField, string[]> = {
  old: ["vanha mittari", "vanha mittarinumero", "vanha", "vanhan mittarin numero", "poistettu mittari"],
  place: ["käyttöpaikka", "käyttöpaikan tunnus", "unes", "kohde", "asiakasnumero"],
  date: ["vaihtopäivä", "vaihtopvm", "päivä", "pvm", "asennuspäivä"],
  final: ["loppulukema", "vanhan lukema", "vanhan mittarin lukema", "vanha lukema"],
  new: ["uusi mittari", "uusi mittarinumero", "uusi", "uuden mittarin numero", "asennettu mittari"],
  start: ["aloituslukema", "uuden lukema", "uuden mittarin lukema", "uusi lukema"],
  method: ["lukutapa"],
};
export const REQUIRED_FIELDS: SwapField[] = ["old", "date", "final", "new"];
export const FIELD_LABEL: Record<SwapField, string> = {
  old: "Vanha mittari", place: "Käyttöpaikka", date: "Vaihtopäivä", final: "Loppulukema", new: "Uusi mittari", start: "Aloituslukema", method: "Lukutapa",
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9åäö ]/g, " ").replace(/\s+/g, " ").trim();

function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === sep && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

export type RawSwapRow = Partial<Record<SwapField, string>>;

/** CSV (puolipiste, pilkku tai sarkain) riveiksi. Tyhjät rivit ohitetaan. */
export function parseSwapCsv(text: string): { rows: { rowNo: number; raw: RawSwapRow }[] } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => l.trim() !== "");
  if (headerIdx < 0) throw new CampaignError("Tiedosto on tyhjä.");
  const header = lines[headerIdx];
  const sep = [";", "\t", ","].map((s) => [s, header.split(s).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const cols = splitLine(header, sep).map(norm);
  const index: Partial<Record<SwapField, number>> = {};
  for (const f of Object.keys(HEADERS) as SwapField[]) {
    const names = HEADERS[f].map(norm);
    const i = cols.findIndex((c) => names.includes(c));
    if (i >= 0) index[f] = i;
  }
  const missing = REQUIRED_FIELDS.filter((f) => index[f] === undefined && !(f === "old" && index.place !== undefined));
  if (missing.length) {
    throw new CampaignError(`Tiedostosta puuttuu sarake: ${missing.map((f) => FIELD_LABEL[f]).join(", ")}. Otsikkorivillä pitää olla ${REQUIRED_FIELDS.map((f) => FIELD_LABEL[f]).join(", ")}.`);
  }
  const rows: { rowNo: number; raw: RawSwapRow }[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cells = splitLine(lines[i], sep);
    if (cells.every((c) => c === "")) continue;
    const raw: RawSwapRow = {};
    for (const [f, ci] of Object.entries(index) as [SwapField, number][]) raw[f] = cells[ci] ?? "";
    rows.push({ rowNo: i + 1, raw });
  }
  if (rows.length === 0) throw new CampaignError("Tiedostossa ei ole vaihtorivejä.");
  if (rows.length > 3000) throw new CampaignError("Erässä voi olla enintään 3000 riviä. Jaa tiedosto osiin.");
  return { rows };
}

/** Päivä muodossa 1.4.2026, 01.04.2026 tai 2026-04-01. */
export function parseDate(v: string | undefined): string | null {
  const s = (v ?? "").trim();
  let y: number, m: number, d: number;
  const fiM = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  const isoM = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (fiM) [d, m, y] = [Number(fiM[1]), Number(fiM[2]), Number(fiM[3])];
  else if (isoM) [y, m, d] = [Number(isoM[1]), Number(isoM[2]), Number(isoM[3])];
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

function parseMethod(v: string | undefined): "remote" | "mechanical" | null | undefined {
  const s = norm(v ?? "");
  if (!s) return undefined;
  if (s.startsWith("etä") || s === "remote") return "remote";
  if (s.startsWith("mek") || s.startsWith("käsi") || s === "mechanical") return "mechanical";
  return null;
}

export interface OrgMeter extends SwapMeterState {
  id: string;
  placeCode: string | null;
  propertyId: string;
  removedOn: string | null;
}

export interface CheckedRow {
  rowNo: number;
  raw: RawSwapRow;
  oldMeterNumber: string | null;
  placeCode: string | null;
  changeDate: string | null;
  finalReading: number | null;
  newMeterNumber: string | null;
  startReading: number | null;
  readMethod: "remote" | "mechanical" | null;
  status: "ready" | "error" | "skipped";
  message: string | null;
  oldMeterId: string | null;
}

/**
 * Rivien tarkistus organisaation mittareita vasten muistissa, jotta
 * tuhannenkin rivin erä tarkistuu yhdellä kyselyllä.
 */
export function checkSwapRows(rows: { rowNo: number; raw: RawSwapRow }[], meters: OrgMeter[], today: string): CheckedRow[] {
  const active = meters.filter((m) => m.removedOn === null);
  const seenOld = new Set<string>();
  const seenNew = new Set<string>();
  return rows.map(({ rowNo, raw }) => {
    const oldNo = normalizeMeterNumber(raw.old) || null;
    const place = (raw.place ?? "").trim() || null;
    const date = parseDate(raw.date);
    const final = raw.final?.trim() ? parseReading(raw.final) : null;
    const newNo = (raw.new ?? "").trim() || null;
    const start = raw.start?.trim() ? parseReading(raw.start) : 0;
    const method = parseMethod(raw.method);
    const base = {
      rowNo, raw, oldMeterNumber: raw.old?.trim() || null, placeCode: place, changeDate: date, finalReading: final, newMeterNumber: newNo,
      startReading: start, readMethod: method === undefined ? ("remote" as const) : method, oldMeterId: null as string | null,
    };
    const error = (message: string) => ({ ...base, status: "error" as const, message });
    if (!date) return error("Vaihtopäivä puuttuu tai on väärää muotoa (esim. 1.4.2026).");
    if (final === null) return error("Loppulukema puuttuu tai ei ole luku.");
    if (start === null) return error("Aloituslukema ei ole luku.");
    if (!newNo) return error("Uuden mittarin numero puuttuu.");
    if (method === null) return error("Lukutapa on etäluettava tai mekaaninen.");
    if (!oldNo && !place) return error("Vanhan mittarin numero tai käyttöpaikka puuttuu.");

    const atPlace = (m: OrgMeter) => !place || (m.placeCode ?? "").toUpperCase() === place.toUpperCase();
    const candidates = active.filter((m) => (oldNo ? normalizeMeterNumber(m.meterNumber) === oldNo : true) && atPlace(m));
    if (candidates.length === 0) {
      // Sama vaihto kirjattu jo aiemmin (esim. edellisessä erässä): ohitetaan.
      const newActive = active.find((m) => normalizeMeterNumber(m.meterNumber) === normalizeMeterNumber(newNo));
      const oldRemoved = meters.find((m) => m.removedOn !== null && (oldNo ? normalizeMeterNumber(m.meterNumber) === oldNo : true) && atPlace(m));
      if (newActive && oldRemoved && newActive.propertyId === oldRemoved.propertyId) {
        return { ...base, oldMeterId: oldRemoved.id, status: "skipped" as const, message: "Vaihto on jo kirjattu." };
      }
      return error(place && oldNo ? "Vanhaa mittaria ei löytynyt käytöstä tältä käyttöpaikalta." : "Vanhaa mittaria ei löytynyt käytöstä.");
    }
    if (candidates.length > 1) {
      return error(oldNo ? "Samalla numerolla on useita käytössä olevia mittareita. Lisää käyttöpaikan tunnus." : "Käyttöpaikalla on useita mittareita. Lisää vanhan mittarin numero.");
    }
    const old = candidates[0];
    if (seenOld.has(old.id)) return error("Sama vanha mittari on erässä jo aiemmalla rivillä.");
    seenOld.add(old.id);
    const newKey = normalizeMeterNumber(newNo);
    if (seenNew.has(newKey)) return error("Sama uusi mittari on erässä jo aiemmalla rivillä.");
    seenNew.add(newKey);
    if (active.some((m) => m.id !== old.id && normalizeMeterNumber(m.meterNumber) === newKey)) return error("Uusi mittarinumero on jo käytössä toisella mittarilla.");
    const problem = swapProblem(old, { date, finalReading: final, newMeterNumber: newNo, startReading: start }, today);
    if (problem) return { ...error(problem), oldMeterId: old.id };
    return { ...base, oldMeterId: old.id, status: "ready" as const, message: null };
  });
}

export async function loadOrgMeters(tx: Sql, orgId: string): Promise<OrgMeter[]> {
  const rows = await tx.query<{
    id: string; meter_number: string | null; installed_on: string; start_reading: string; removed_on: string | null; property_id: string;
    legacy_id: string | null; readings: { d: string; r: string; s: string }[] | null;
  }>(
    `select m.id, m.meter_number, m.installed_on::text, m.start_reading::text, m.removed_on::text, k.property_id, p.legacy_id,
            (select json_agg(json_build_object('d', r.read_on::text, 'r', r.reading::text, 's', r.status))
               from ml_readings r where r.meter_id = m.id and r.status <> 'rejected') as readings
       from ml_meters m join ml_connections k on k.id = m.connection_id join ml_properties p on p.id = k.property_id
      where m.organization_id = $1`,
    [orgId],
  );
  return rows.map((m) => ({
    id: m.id, meterNumber: m.meter_number, installedOn: m.installed_on, startReading: Number(m.start_reading), removedOn: m.removed_on,
    propertyId: m.property_id, placeCode: m.legacy_id, readings: (m.readings ?? []).map((r) => ({ readOn: r.d, reading: Number(r.r), status: r.s })),
  }));
}

async function saveChecked(tx: Sql, orgId: string, batchId: string, rows: CheckedRow[]) {
  await tx.query(
    `insert into ml_meter_swap_rows (organization_id, batch_id, row_no, raw, old_meter_number, place_code, change_date, final_reading, new_meter_number,
                                     start_reading, read_method, status, message, old_meter_id)
     select $1, $2, x.row_no, x.raw, x.old_meter_number, x.place_code, x.change_date, x.final_reading, x.new_meter_number, x.start_reading,
            x.read_method, x.status, x.message, x.old_meter_id
       from json_to_recordset($3::json) as x(row_no int, raw jsonb, old_meter_number text, place_code text, change_date date, final_reading numeric,
            new_meter_number text, start_reading numeric, read_method text, status text, message text, old_meter_id uuid)
     on conflict (batch_id, row_no) do update set
       old_meter_number = excluded.old_meter_number, place_code = excluded.place_code, change_date = excluded.change_date,
       final_reading = excluded.final_reading, new_meter_number = excluded.new_meter_number, start_reading = excluded.start_reading,
       read_method = excluded.read_method, status = excluded.status, message = excluded.message, old_meter_id = excluded.old_meter_id`,
    [
      orgId, batchId,
      JSON.stringify(rows.map((r) => ({
        row_no: r.rowNo, raw: r.raw, old_meter_number: r.oldMeterNumber, place_code: r.placeCode, change_date: r.changeDate, final_reading: r.finalReading,
        new_meter_number: r.newMeterNumber, start_reading: r.startReading, read_method: r.readMethod, status: r.status, message: r.message,
        old_meter_id: r.oldMeterId,
      }))),
    ],
  );
}

export async function createSwapBatch(
  tx: Sql,
  input: { organizationId: string; userId: string; name: string; filename: string | null; csv: string; today: string },
): Promise<{ batchId: string; ready: number; errors: number; skipped: number }> {
  const { rows } = parseSwapCsv(input.csv);
  const [batch] = await tx.query<{ id: string }>(
    "insert into ml_meter_swap_batches (organization_id, name, filename, created_by) values ($1, $2, $3, $4) returning id",
    [input.organizationId, input.name, input.filename, input.userId],
  );
  const checked = checkSwapRows(rows, await loadOrgMeters(tx, input.organizationId), input.today);
  await saveChecked(tx, input.organizationId, batch.id, checked);
  const count = (s: string) => checked.filter((r) => r.status === s).length;
  await audit(tx, {
    organizationId: input.organizationId, userId: input.userId, action: "meter_swap_batch.create", entity: "ml_meter_swap_batches", entityId: batch.id,
    details: { rows: checked.length, ready: count("ready"), errors: count("error") },
  });
  return { batchId: batch.id, ready: count("ready"), errors: count("error"), skipped: count("skipped") };
}

/** Tarkistaa viemättömät rivit uudelleen, kun rekisteriä on korjattu. */
export async function recheckSwapBatch(tx: Sql, input: { organizationId: string; batchId: string; today: string }) {
  const rows = await tx.query<{ row_no: number; raw: RawSwapRow }>(
    "select row_no, raw from ml_meter_swap_rows where batch_id = $1 and organization_id = $2 and status <> 'applied' order by row_no",
    [input.batchId, input.organizationId],
  );
  // Jo viedyt vaihdot ovat rekisterissä, joten ne tunnistuvat tarkistuksessa "jo kirjatuiksi" eivätkä tule uudelleen.
  const checked = checkSwapRows(rows.map((r) => ({ rowNo: r.row_no, raw: r.raw })), await loadOrgMeters(tx, input.organizationId), input.today);
  await saveChecked(tx, input.organizationId, input.batchId, checked);
  return { ready: checked.filter((r) => r.status === "ready").length, errors: checked.filter((r) => r.status === "error").length };
}

/** Rivejä kerralla: palvelinfunktion aikaraja riittää, ja loput viedään seuraavalla painalluksella. */
export const APPLY_CHUNK = 150;

export async function applySwapBatch(
  tx: Sql,
  input: { organizationId: string; userId: string; batchId: string; today: string },
): Promise<{ applied: number; failed: number; remaining: number }> {
  const rows = await tx.query<{
    id: string; old_meter_id: string; change_date: string; final_reading: string; new_meter_number: string; start_reading: string; read_method: "remote" | "mechanical";
  }>(
    `select id, old_meter_id, change_date::text, final_reading::text, new_meter_number, start_reading::text, read_method
       from ml_meter_swap_rows where batch_id = $1 and organization_id = $2 and status = 'ready' order by row_no limit $3`,
    [input.batchId, input.organizationId, APPLY_CHUNK],
  );
  let applied = 0;
  let failed = 0;
  for (const r of rows) {
    // Jokainen vaihto omana kokonaisuutenaan: epäonnistunut rivi perutaan savepointilla, ja muut jatkuvat.
    await tx.query("savepoint swap_row");
    try {
      const res = await swapMeter(tx, {
        organizationId: input.organizationId, userId: input.userId, oldMeterId: r.old_meter_id, today: input.today, date: r.change_date,
        finalReading: Number(r.final_reading), newMeterNumber: r.new_meter_number, startReading: Number(r.start_reading), readMethod: r.read_method,
        source: "campaign", batchId: input.batchId,
      });
      await tx.query("update ml_meter_swap_rows set status = 'applied', message = null, new_meter_id = $2, applied_at = now() where id = $1", [r.id, res.newMeterId]);
      await tx.query("release savepoint swap_row");
      applied++;
    } catch (err) {
      await tx.query("rollback to savepoint swap_row");
      const message = err instanceof MeterSwapError ? err.message : "Vaihdon kirjaus epäonnistui. Tarkista rivi ja yritä uudelleen.";
      await tx.query("update ml_meter_swap_rows set status = 'error', message = $2 where id = $1", [r.id, message]);
      failed++;
    }
  }
  const [{ n }] = await tx.query<{ n: number }>(
    "select count(*)::int as n from ml_meter_swap_rows where batch_id = $1 and status = 'ready'",
    [input.batchId],
  );
  await audit(tx, {
    organizationId: input.organizationId, userId: input.userId, action: "meter_swap_batch.apply", entity: "ml_meter_swap_batches", entityId: input.batchId,
    details: { applied, failed, remaining: n },
  });
  return { applied, failed, remaining: n };
}

export const SWAP_STATUS: Record<string, { label: string; tone: "ok" | "warn" | "alert" | "neutral" | "info" }> = {
  ready: { label: "Valmis", tone: "info" },
  error: { label: "Korjattava", tone: "alert" },
  skipped: { label: "Ohitettu", tone: "neutral" },
  applied: { label: "Kirjattu", tone: "ok" },
};
