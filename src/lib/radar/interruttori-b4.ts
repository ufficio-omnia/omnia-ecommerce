// Fase B4 (B1) — Interruttori dell'interfaccia per gradi (piano 26A §6, approvato il 19/11/2026). Logica pura: legge solo l'ambiente che riceve.
// Stesso schema di classificazioniAttive (ambiente.ts): valgono SOLO con il valore esatto «attivo» E con il database dello staging. Di base
// sono SPENTI; in produzione restano spenti qualunque valore abbiano, finché un'autorizzazione separata non cambia il codice.
//   1. RADAR_PER_TE               → «Per te» e pagina del profilo di ricerca;
//   2. RADAR_UFFICIO_GARE         → Opportunità aperta all'Ufficio Gare (matrice del §2 di 26A);
//   3. RADAR_NOTIFICHE_PREFERENZE → pagina «Notifiche» e azioni delle preferenze (il motore degli invii è RADAR_NOTIFICHE_EMAIL di B2).
import { ambienteDb } from "./ambiente";

export const INTERRUTTORI_B4 = ["RADAR_PER_TE", "RADAR_UFFICIO_GARE", "RADAR_NOTIFICHE_PREFERENZE"] as const;
export type InterruttoreB4 = (typeof INTERRUTTORI_B4)[number];

/** Acceso solo con «attivo» (nient'altro: né «1», né «true», né spazi) e solo con il database dello staging. */
export function interruttoreB4(nome: InterruttoreB4, env: Record<string, string | undefined>): boolean {
  return env[nome] === "attivo" && ambienteDb(env.NEXT_PUBLIC_SUPABASE_URL) === "staging";
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
 * SOLO per l'avviso della pagina «Notifiche» («gli avvisi email non sono ancora attivi»): il motore degli invii è di B2 e la regola che conta è
 * la sua. Qui la lettura più prudente (accesi solo con «attivo» sullo staging): nel dubbio la pagina dice che non sono attivi. Da allineare
 * alla funzione del motore di B2 all'integrazione.
 */
export function invioEmailDichiaratoAcceso(env: Record<string, string | undefined>): boolean {
  return env.RADAR_NOTIFICHE_EMAIL === "attivo" && ambienteDb(env.NEXT_PUBLIC_SUPABASE_URL) === "staging";
}
