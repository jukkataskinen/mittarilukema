import Link from "next/link";
import { Brand } from "@/components/Brand";

/**
 * Ohjeet ovat julkisia: etusivu esittelee toiminnot myös myyntitilanteessa
 * ilman kirjautumista. Sivuilla ei ole asiakastietoja.
 */
export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-cloud">
      <header className="border-b border-line bg-paper">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href="/ohjeet" aria-label="Ohjeiden etusivu">
            <Brand size={24} />
          </Link>
          <nav className="flex items-center gap-5 text-sm font-semibold">
            <Link href="/ohjeet" className="text-ink/70 hover:text-ink">
              Toiminnot
            </Link>
            <Link href="/tyopoyta" className="rounded-lg bg-ink px-3 py-1.5 text-paper hover:bg-ink/85">
              Sovellukseen
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">{children}</main>
    </div>
  );
}
