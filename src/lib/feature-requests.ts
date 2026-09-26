import { HELP_TOPICS } from "@/lib/help/topics";

/**
 * Kehitystoiveet (0025). Toive kohdistetaan toimintoon, joka on sama kuin
 * ohjesivuston aihe, jotta toiveet ryhmittyvät samoin kuin ohjeet ja toiminnot.
 */

export const OTHER_FEATURE = "muu";

export function featureOptions(): { value: string; label: string; group: string }[] {
  return [
    ...HELP_TOPICS.filter((t) => t.slug !== "kehitystoiveet").map((t) => ({ value: t.slug, label: t.title, group: t.group })),
    { value: OTHER_FEATURE, label: "Uusi toiminto tai muu asia", group: "Muu" },
  ];
}

export function featureLabel(slug: string): string {
  return featureOptions().find((f) => f.value === slug)?.label ?? "Muu asia";
}

export const IMPORTANCE_LABEL: Record<string, string> = {
  nice: "Olisi mukava",
  important: "Tärkeä",
  blocking: "Estää työn",
};

export const REQUEST_STATUS: Record<string, { label: string; tone: "info" | "warn" | "ok" | "neutral" }> = {
  new: { label: "Uusi", tone: "info" },
  planned: { label: "Suunnitteilla", tone: "warn" },
  in_progress: { label: "Työn alla", tone: "warn" },
  done: { label: "Tehty", tone: "ok" },
  declined: { label: "Ei toteuteta", tone: "neutral" },
};
