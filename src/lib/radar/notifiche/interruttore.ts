// Fase B4 (20/11/2026, B2) — INTERRUTTORE UNICO del motore delle notifiche email di Tender Intelligence (RADAR_NOTIFICHE_EMAIL).
// Logica PURA: legge solo l'ambiente che riceve. È la sola regola che decide se il motore lavora: la usano la rotta del processo giornaliero,
// il motore, l'aggancio della «scadenza ravvicinata» e l'avviso della pagina «Notifiche» di B1 («gli avvisi email non sono ancora attivi»).
//
// Acceso SOLO se valgono insieme:
//   - RADAR_NOTIFICHE_EMAIL con il valore esatto «attivo» (né «1», né «true», né spazi). Di base è SPENTO;
//   - NON su un'anteprima di Vercel (VERCEL_ENV=preview): la Preview legge lo staging, non lo scrive (come gli importatori, fase B3);
//   - database dello STAGING. In produzione resta spento qualunque valore abbia la variabile, finché un'autorizzazione separata non cambia
//     il codice (decisione dell'utente del 19/11: «Le notifiche devono essere disattivate di default fino alla specifica autorizzazione di
//     accensione»). Un database non riconosciuto vale come produzione.
// Anche acceso, il motore della B4 usa SOLO il provider finto: Resend reale resta chiuso nel codice (resendConsentito, provider.ts).

import { ambienteDb } from "../ambiente";

export const VARIABILE_INTERRUTTORE_EMAIL = "RADAR_NOTIFICHE_EMAIL";

export type MotivoInvioSpento = "spento" | "anteprima" | "ambiente_non_autorizzato";

export type StatoInvioEmail = { acceso: true; ambiente: "staging" } | { acceso: false; motivo: MotivoInvioSpento };

export function statoInvioEmail(env: Record<string, string | undefined>): StatoInvioEmail {
  if (env[VARIABILE_INTERRUTTORE_EMAIL] !== "attivo") return { acceso: false, motivo: "spento" };
  if (env.VERCEL_ENV === "preview") return { acceso: false, motivo: "anteprima" };
  if (ambienteDb(env.NEXT_PUBLIC_SUPABASE_URL) !== "staging") return { acceso: false, motivo: "ambiente_non_autorizzato" };
  return { acceso: true, ambiente: "staging" };
}

/** «Invio email acceso»: il motore delle notifiche lavora (in B4 sempre con il provider finto). */
export function invioEmailAcceso(env: Record<string, string | undefined>): boolean {
  return statoInvioEmail(env).acceso;
}
