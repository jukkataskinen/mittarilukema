"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { isoDateHelsinki } from "@/lib/format";
import { LinkError, submitLinkReading } from "@/lib/readings/links";

/** Julkinen lukemailmoitus. Linkki tarkistetaan uudelleen jokaisessa lähetyksessä. */
export async function submitReadingAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) redirect("/");
  const back = `/lukema/${token}`;
  const reading = String(formData.get("reading") ?? "").trim();
  const readOn = String(formData.get("readOn") ?? "");
  const today = isoDateHelsinki();
  const fail = (msg: string): never => redirect(`${back}?virhe=${encodeURIComponent(msg)}`);
  if (!reading) fail("Anna lukema.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(readOn) || readOn > today) fail("Tarkista lukemapäivä.");
  // Vanha päivämäärä on todennäköisesti näppäilyvirhe; kierroksen lukemat ovat tuoreita.
  if (Date.parse(today) - Date.parse(readOn) > 90 * 86_400_000) fail("Lukemapäivä voi olla enintään kolmen kuukauden takaa.");

  let issues: string[] = [];
  try {
    issues = (await submitLinkReading(await getDb(), token, { reading, readOn })).issues;
  } catch (err) {
    if (err instanceof LinkError) fail(err.message);
    throw err;
  }
  redirect(`${back}?kiitos=${issues.length ? "tarkistetaan" : "1"}`);
}
