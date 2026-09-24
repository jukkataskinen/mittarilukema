import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { handleInboundSms } from "@/lib/sms/inbound";
import { smsSender } from "@/lib/sms";

/**
 * Saapuvat tekstiviestit palveluntarjoajalta. Palveluriippumaton muoto:
 * { from, to, text, id?, timestamp? }. Kun palvelu valitaan (BLOCKERS 2),
 * sen oma muoto muunnetaan tähän joko palvelun asetuksissa tai tässä.
 * Suojaus: Authorization: Bearer <SMS_WEBHOOK_SECRET>. Ilman salaisuutta
 * reitti ei ole käytössä.
 */
const schema = z.object({
  from: z.string().min(3).max(32),
  to: z.string().min(3).max(32).nullable().optional(),
  text: z.string().max(1000),
  id: z.string().max(200).nullable().optional(),
  timestamp: z.string().datetime({ offset: true }).nullable().optional(),
});

function authorized(request: Request): boolean {
  const secret = process.env.SMS_WEBHOOK_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function POST(request: Request) {
  if (!process.env.SMS_WEBHOOK_SECRET) return NextResponse.json({ error: "not configured" }, { status: 503 });
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const m = parsed.data;
  const res = await handleInboundSms(await getDb(), {
    from: m.from, to: m.to ?? null, body: m.text, providerMessageId: m.id ?? null, receivedAt: m.timestamp ?? undefined,
  });
  if (res.reply && res.status !== "duplicate") await smsSender().send(m.from, res.reply);
  return NextResponse.json({ status: res.status });
}
