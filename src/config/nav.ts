import type { IconName } from "@/components/NavIcon";
import type { OrgRole } from "@/lib/auth/current-user";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  roles?: OrgRole[];
}

/** Päivittäinen työ: rekisteri ja lukemat. */
export const STAFF_NAV: NavItem[] = [
  { href: "/tyopoyta", label: "Työpöytä", icon: "home" },
  { href: "/kiinteistot", label: "Kiinteistöt", icon: "building" },
  { href: "/asiakkaat", label: "Asiakkaat", icon: "users" },
  { href: "/lukemat", label: "Lukemat", icon: "droplet" },
  { href: "/mittarinvaihdot", label: "Mittarinvaihdot", icon: "wrench", roles: ["owner", "staff"] },
  { href: "/muutosilmoitukset", label: "Muutosilmoitukset", icon: "pen", roles: ["owner", "staff"] },
  { href: "/laskutus", label: "Laskutus", icon: "registry", roles: ["owner", "staff"] },
  { href: "/tiedotteet", label: "Tiedotteet", icon: "megaphone", roles: ["owner", "staff"] },
];

/** Organisaation asetukset ja hinnat. */
export const STAFF_NAV_ORG: NavItem[] = [
  { href: "/hinnasto", label: "Hinnasto", icon: "coins", roles: ["owner", "staff"] },
  { href: "/tuotteet", label: "Tuotteet ja tilit", icon: "list", roles: ["owner", "staff"] },
  { href: "/asetukset", label: "Asetukset", icon: "gear", roles: ["owner"] },
  { href: "/ohjeet", label: "Ohjeet", icon: "info" },
  { href: "/kehitystoiveet", label: "Kehitystoiveet", icon: "bolt" },
];
