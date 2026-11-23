// User-Agent delle letture delle fonti (K9 del 48C, L7 del piano 36, D7 dell'utente del 23/11: contatto reale prima della produzione).
// Logica pura: legge solo l'ambiente che riceve.
//
//   - con RADAR_CONTATTO_FONTI valido (indirizzo email o pagina https): «OMNIA-AI-TenderIntelligence/1.0 (+https://omnia-ai.it; contatto: …)»
//     per TUTTE le fonti, in ogni ambiente;
//   - senza contatto: nello staging lo User-Agent generico di prima; altrove (produzione o database sconosciuto) il giro NON parte
//     («contatto_mancante»);
//   - contatto presente ma in una forma non valida: il giro non parte in nessun ambiente (errore di configurazione da correggere).
// Il contatto NON è nel codice (variabile del server) e non finisce mai in log, errori o registro dei giri: solo nell'intestazione delle
// richieste alle fonti.
import { ambienteDb } from "../ambiente";

export const USER_AGENT_GENERICO = "omnia-radar/1.0 (lettura avvisi pubblici)";
// sito del prodotto nello User-Agent (piano 36 §L7; da confermare con l'utente insieme al contatto)
export const SITO_PRODOTTO = "https://omnia-ai.it";
export const VARIABILE_CONTATTO = "RADAR_CONTATTO_FONTI";

export type UserAgentFonti = { ok: true; valore: string; conContatto: boolean } | { ok: false; motivo: "contatto_mancante" | "contatto_non_valido" };

const EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}$/;
const PAGINA = /^https:\/\/[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+(\/[A-Za-z0-9._~\/-]*)?$/;

/** Un contatto accettabile in un'intestazione: email o pagina https, al più 120 caratteri, nessun carattere che possa rompere l'intestazione. */
export function contattoValido(x: string): boolean {
  return x.length > 0 && x.length <= 120 && (EMAIL.test(x) || PAGINA.test(x));
}

export function userAgentFonti(env: Record<string, string | undefined>): UserAgentFonti {
  const contatto = (env[VARIABILE_CONTATTO] ?? "").trim();
  if (contatto) {
    if (!contattoValido(contatto)) return { ok: false, motivo: "contatto_non_valido" };
    return { ok: true, valore: `OMNIA-AI-TenderIntelligence/1.0 (+${SITO_PRODOTTO}; contatto: ${contatto})`, conContatto: true };
  }
  if (ambienteDb(env.NEXT_PUBLIC_SUPABASE_URL) === "staging") return { ok: true, valore: USER_AGENT_GENERICO, conContatto: false };
  return { ok: false, motivo: "contatto_mancante" };
}

/** Il motivo per il registro dei giri e per la console: dice che cosa manca, MAI il valore del contatto. */
export function testoContattoMancante(motivo: "contatto_mancante" | "contatto_non_valido"): string {
  return motivo === "contatto_mancante"
    ? `User-Agent senza contatto: fuori dallo staging serve ${VARIABILE_CONTATTO} (indirizzo email o pagina https); giro non partito`
    : `${VARIABILE_CONTATTO} non è un indirizzo email né una pagina https valida; giro non partito`;
}
