/**
 * Mittarilukeman merkki: vesimittarin kehä, jonka sisällä on sky-sininen
 * pisara ja lukemaikkuna. Sama muotokieli kuin eRapun talossa.
 */
export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <circle cx={50} cy={50} r={38} fill="none" stroke="currentColor" strokeWidth={7} />
      <path d="M50 22 C58 33 64 41 64 49 a14 14 0 0 1 -28 0 C36 41 42 33 50 22 Z" fill="var(--color-sky)" />
      <rect x={34} y={66} width={32} height={10} rx={2.5} fill="var(--color-coral)" />
    </svg>
  );
}

export function Brand({ size = 22 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2 text-ink">
      <LogoMark size={size} />
      <span className="font-extrabold tracking-tight">
        Mittari<span className="text-sky">lukema</span>
      </span>
    </span>
  );
}
