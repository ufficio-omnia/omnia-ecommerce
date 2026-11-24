// Fase B4 (20/11/2026, B2) — INTERRUTTORE UNICO del motore delle notifiche email di Tender Intelligence (RADAR_NOTIFICHE_EMAIL).
// Logica PURA: legge solo l'ambiente che riceve. È la sola regola che decide se il motore lavora: la usano la rotta del processo giornaliero,
// il motore, l'aggancio della «scadenza ravvicinata» e l'avviso della pagina «Notifiche» di B1 («gli avvisi email non sono ancora attivi»).
//
// Acceso SOLO se valgono insieme:
//   - RADAR_NOTIFICHE_EMAIL con il valore esatto «attivo» (né «1», né «true», né spazi). Di base è SPENTO;
//   - NON su un'anteprima di Vercel (VERCEL_ENV=preview): la Preview legge lo staging, non lo scrive (come gli importatori, fase B3);
//   - database dello STAGING; oppure, col pacchetto P (piano 55 §2, decisione D-F del 23/11, schema di K8), database di PRODUZIONE sul deploy
//     di produzione di Vercel (VERCEL_ENV=production). Mai un database sconosciuto, mai un ambiente locale verso la produzione.
// Di base è SPENTO ovunque (decisione dell'utente del 19/11: «Le notifiche devono essere disattivate di default fino alla specifica
// autorizzazione di accensione»; 55A D-C: le email ai clienti si accendono in F8, dopo 3–5 giorni di dati stabili, prima con un indirizzo
// interno). Sullo staging il motore usa SOLO il provider finto; Resend vale solo in produzione (resendConsentito, provider.ts).

import { ambienteDb } from "../ambiente";

export const VARIABILE_INTERRUTTORE_EMAIL = "RADAR_NOTIFICHE_EMAIL";

export type MotivoInvioSpento = "spento" | "anteprima" | "ambiente_non_autorizzato";

export type StatoInvioEmail = { acceso: true; ambiente: "staging" | "produzione" } | { acceso: false; motivo: MotivoInvioSpento };

export function statoInvioEmail(env: Record<string, string | undefined>): StatoInvioEmail {
  if (env[VARIABILE_INTERRUTTORE_EMAIL] !== "attivo") return { acceso: false, motivo: "spento" };
  if (env.VERCEL_ENV === "preview") return { acceso: false, motivo: "anteprima" };
  const ambiente = ambienteDb(env.NEXT_PUBLIC_SUPABASE_URL);
  if (ambiente === "staging") return { acceso: true, ambiente: "staging" };
  if (ambiente === "produzione" && env.VERCEL_ENV === "production") return { acceso: true, ambiente: "produzione" };
  return { acceso: false, motivo: "ambiente_non_autorizzato" };
}

/** «Invio email acceso»: il motore delle notifiche lavora (provider finto sullo staging, Resend solo in produzione). */
export function invioEmailAcceso(env: Record<string, string | undefined>): boolean {
  return statoInvioEmail(env).acceso;
}
