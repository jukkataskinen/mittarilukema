/**
 * Joutsan tuotteiden säännöt tuotenimestä (Joutsan Vesihuollon Fennoa-tuotteet 26.9.2026).
 *
 *   "Veden perusmaksu Joutsa"            perusmaksu, vesi, omakotitalo
 *   "Veden perusmaksu DN 20 Joutsa"      perusmaksu, vesi, DN20
 *   "Veden kulutus kunta"                käyttömaksu, vesi, asiakasryhmä kunta
 *   "Jäteveden perusmaksu Rutalahti"     perusmaksu, jätevesi, omakotitalo, alue Rutalahti
 *   "…, ei mittaria Joutsa"              kiinteistöllä ei mittaria
 *
 * Leivonmäen ja Rutalahden tuotteet sidotaan samannimiseen alueeseen. Tuonti
 * jättää ne käsin valittaviksi, jos aluetta ei ole (Leivonmäki = entinen
 * Alue 7, DECISIONS 26.9.2026). Hyvitys-, myynti- ja palvelutuotteet ovat
 * aina käsin valittavia.
 */

export interface JoutsaRule {
  autoMatch: boolean;
  chargeType: "usage_fee" | "basic_fee" | null;
  connectionKind: "water" | "wastewater" | null;
  feeClass: string | null;
  areaName: string | null;
  customerGroup: string | null;
  metered: boolean | null;
}

const MANUAL: JoutsaRule = { autoMatch: false, chargeType: null, connectionKind: null, feeClass: null, areaName: null, customerGroup: null, metered: null };

export function joutsaRule(name: string): JoutsaRule {
  const n = name.toLowerCase();
  if (/hyvitys|palopostivesi|mittarimyynti|vedenotto|vesiasema|liete|liittymis|muu myynti/.test(n)) return MANUAL;
  const basic = /perusmaksu/.test(n);
  const usage = /kulutus/.test(n);
  if (!basic && !usage) return MANUAL;
  const kind = /jätevesi|jäteveden/.test(n) ? "wastewater" : /veden|vesi/.test(n) ? "water" : null;
  if (!kind) return MANUAL;
  const dn = /dn\s*(\d{2})/.exec(n);
  const leivonmaki = /leivonmäki/.test(n);
  const rutalahti = /rutalahti/.test(n);
  const kunta = /\bkunta\b/.test(n);
  return {
    autoMatch: true,
    chargeType: basic ? "basic_fee" : "usage_fee",
    connectionKind: kind,
    feeClass: basic ? (dn ? `dn${dn[1]}` : "okt") : null,
    areaName: rutalahti ? "Rutalahti" : leivonmaki ? "Leivonmäki" : null,
    customerGroup: kunta ? "kunta" : null,
    metered: /ei mittaria/.test(n) ? false : null,
  };
}
