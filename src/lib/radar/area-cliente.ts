// Tender Intelligence nell'area riservata: voce di menu, percorsi, guardia del diritto per pagine e azioni. Solo server.
// Fase B1: le pagine «Opportunità» sono del TITOLARE (guardie richiediTitolarePagina / richiediTitolareAzione); l'Ufficio Gare (D3)
// si aggiungerà quando servirà, con le sue prove, senza toccare ora le regole già in produzione.
import { notFound } from "next/navigation";
import { RADICE_AREA, type VoceMenu } from "@/lib/omnia-ai-account-calcoli";
import { leggiContestoRadar, type ContestoRadar } from "./impostazioni";
import type { DirittoRadar } from "./diritto-calcoli";

export const RADICE_OPPORTUNITA = `${RADICE_AREA}/opportunita`;
export const VOCE_MENU_OPPORTUNITA: VoceMenu = { href: RADICE_OPPORTUNITA, label: "Opportunità" };

// La voce sta subito dopo «Dashboard» (05_UX_E_INTEGRAZIONE, §3).
export function vociConOpportunita(voci: readonly VoceMenu[]): VoceMenu[] {
  const i = voci.findIndex((v) => v.href === RADICE_AREA);
  return [...voci.slice(0, i + 1), VOCE_MENU_OPPORTUNITA, ...voci.slice(i + 1)];
}

export type DirittoVisibile = Extract<DirittoRadar, { visibile: true }>;

// Per le pagine: modulo non visibile per questo account = pagina inesistente (404), come se il modulo non ci fosse.
export async function dirittoRadarOppure404(accountId: string): Promise<ContestoRadar & { diritto: DirittoVisibile }> {
  const contesto = await leggiContestoRadar(accountId);
  if (!contesto.diritto.visibile) notFound();
  return contesto as ContestoRadar & { diritto: DirittoVisibile };
}

export const MESSAGGIO_RADAR_NON_DISPONIBILE = "Questa funzione non è disponibile per il tuo account.";
