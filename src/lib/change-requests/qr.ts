import "server-only";
import { headers } from "next/headers";
import QRCode from "qrcode";

/** Lomakkeen julkinen osoite: APP_BASE_URL tai pyynnön oma osoite (kehitys). */
export async function changeFormUrl(token: string): Promise<string> {
  const configured = process.env.APP_BASE_URL?.replace(/\/$/, "");
  if (configured && !configured.includes("localhost")) return `${configured}/ilmoitus/${token}`;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}/ilmoitus/${token}`;
}

/** QR-koodi SVG:nä (tulostukseen) tai PNG:nä (Word ja laskupohjat). Virheenkorjaus M kestää painojäljen pienet virheet. */
export function qrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 2, color: { dark: "#0f1f33", light: "#ffffff" } });
}

export function qrPng(url: string): Promise<Buffer> {
  return QRCode.toBuffer(url, { type: "png", errorCorrectionLevel: "M", margin: 2, width: 800 });
}
