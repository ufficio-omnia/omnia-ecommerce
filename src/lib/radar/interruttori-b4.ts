// Fase B4 (B1) — Interruttori dell'interfaccia per gradi (piano 26A §6, approvato il 19/11/2026). Logica pura: legge solo l'ambiente che riceve.
// Pacchetto P del go-live (55 §2, decisione D-F dell'utente del 23/11: «Sì, subito»), stesso schema di K8 (fonteAutorizzata, ambiente.ts).
// Valgono SOLO con il valore esatto «attivo» e:
//   - mai su un'anteprima di Vercel (VERCEL_ENV=preview), nemmeno sullo staging;
//   - sul database dello staging: accesi (come prima);
//   - sul database di produzione: SOLO dal deploy di produzione su Vercel (VERCEL_ENV=production), mai da un computer locale;
//   - un database non riconosciuto: mai.
// Di base sono SPENTI. In produzione le variabili si creano su Vercel (ambiente Production) solo con l'autorizzazione dell'utente.
//   1. RADAR_PER_TE               → «Per te» e pagina del profilo di ricerca;
//   2. RADAR_UFFICIO_GARE         → Opportunità aperta all'Ufficio Gare (matrice del §2 di 26A);
//   3. RADAR_NOTIFICHE_PREFERENZE → pagina «Notifiche» e azioni delle preferenze (il motore degli invii è RADAR_NOTIFICHE_EMAIL di B2).
import { ambienteDb } from "./ambiente";
import { invioEmailAcceso } from "./notifiche/interruttore";

export const INTERRUTTORI_B4 = ["RADAR_PER_TE", "RADAR_UFFICIO_GARE", "RADAR_NOTIFICHE_PREFERENZE"] as const;
export type InterruttoreB4 = (typeof INTERRUTTORI_B4)[number];

/**
 * Acceso solo con «attivo» (nient'altro: né «1», né «true», né spazi), mai su un'anteprima di Vercel, sullo staging, oppure in produzione
 * solo dal deploy di produzione (VERCEL_ENV=production e database di produzione). Un database non riconosciuto vale come spento.
 */
export function interruttoreB4(nome: InterruttoreB4, env: Record<string, string | undefined>): boolean {
  if (env[nome] !== "attivo") return false;
  if (env.VERCEL_ENV === "preview") return false;
  const ambiente = ambienteDb(env.NEXT_PUBLIC_SUPABASE_URL);
  if (ambiente === "staging") return true;
  return ambiente === "produzione" && env.VERCEL_ENV === "production";
}

export function perTeAttivo(env: Record<string, string | undefined>): boolean {
  return interruttoreB4("RADAR_PER_TE", env);
}

export function ufficioGareRadarAttivo(env: Record<string, string | undefined>): boolean {
  return interruttoreB4("RADAR_UFFICIO_GARE", env);
}

export function preferenzeNotificheAttive(env: Record<string, string | undefined>): boolean {
  return interruttoreB4("RADAR_NOTIFICHE_PREFERENZE", env);
}

/**
 * SOLO per l'avviso della pagina «Notifiche» («gli avvisi email non sono ancora attivi»). Nessuna lettura propria dell'ambiente: delega
 * all'INTERRUTTORE UNICO del motore di B2 (notifiche/interruttore.ts, con la SUA regola d'ambiente, che cambia solo B2), così la pagina
 * dice esattamente ciò che fa il motore (Fase A della B4, A9 del 20/11).
 */
export function invioEmailDichiaratoAcceso(env: Record<string, string | undefined>): boolean {
  return invioEmailAcceso(env);
}
