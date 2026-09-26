"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { helpFor } from "@/lib/help/routes";

/** Sivun ohjelinkki kehyksen yläkulmassa. Ohje valitaan sivun osoitteesta (src/lib/help/routes.ts). */
export function HelpLink() {
  const help = helpFor(usePathname());
  if (!help) return null;
  return (
    <Link
      href={help.href}
      target="_blank"
      title={`Ohje: ${help.title}`}
      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1 text-sm font-semibold text-sky hover:border-sky/40"
    >
      <span aria-hidden="true" className="grid size-4 place-items-center rounded-full bg-sky text-[11px] font-bold text-paper">
        ?
      </span>
      Ohje
      <span className="sr-only">: {help.title} (avautuu uuteen välilehteen)</span>
    </Link>
  );
}
