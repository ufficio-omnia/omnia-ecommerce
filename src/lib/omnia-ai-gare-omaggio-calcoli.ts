// Gare in omaggio (migrazione 0131): gare in più rispetto al piano, regalate dalla console a un cliente
// per un periodo («dal» / «al», giorni di Roma, estremi compresi). Qui i calcoli puri e i testi; la lettura
// dal database sta in omnia-ai-gare-omaggio.ts, l'uso nel conteggio delle gare in gareInclusePerAbbonamento.
// Le gare regalate si sommano a quelle incluse in ogni mese di abbonamento che cade nel periodo: con un
// periodo di due settimane è, in pratica, una gara in più da avviare entro quelle due settimane.

export const GARE_OMAGGIO_MAX = 20;
// un omaggio non dura più di due anni: oltre, è un'altra cosa (un piano diverso o un'offerta)
export const GIORNI_OMAGGIO_MAX = 731;
export const LIMITE_MOTIVO_OMAGGIO = 300;

export type RigaGaraOmaggio = {
  id: string;
  gare: number;
  dal: string;
  al: string;
  motivo: string | null;
  creato_da_email: string;
  creato_il: string;
  revocato_il: string | null;
  revocato_da_email: string | null;
};

export type StatoOmaggio = "in_corso" | "programmato" | "concluso" | "revocato";

export const ETICHETTA_STATO_OMAGGIO: Record<StatoOmaggio, string> = {
  in_corso: "in corso",
  programmato: "programmato",
  concluso: "concluso",
  revocato: "revocato",
};

const GIORNO = /^\d{4}-\d{2}-\d{2}$/;

// «2026-11-18» valido come giorno di calendario (niente 2026-02-30).
export function giornoValido(s: string): boolean {
  if (!GIORNO.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// I giorni sono stringhe «AAAA-MM-GG»: il confronto tra stringhe è quello del calendario.
export function statoOmaggio(o: { dal: string; al: string; revocato_il: string | null }, oggi: string): StatoOmaggio {
  if (o.revocato_il) return "revocato";
  if (oggi < o.dal) return "programmato";
  if (oggi > o.al) return "concluso";
  return "in_corso";
}

// Quante gare in più valgono OGGI: la somma degli omaggi in corso. Righe strane (gare non numeriche,
// date non valide) non valgono nulla: un dato sbagliato non deve mai regalare gare a caso.
export function gareOmaggioInCorso(righe: readonly { gare: unknown; dal: unknown; al: unknown; revocato_il: unknown }[] | null | undefined, oggi: string): number {
  let totale = 0;
  for (const r of righe ?? []) {
    if (typeof r.gare !== "number" || !Number.isInteger(r.gare) || r.gare < 1) continue;
    if (typeof r.dal !== "string" || typeof r.al !== "string" || !giornoValido(r.dal) || !giornoValido(r.al)) continue;
    if (statoOmaggio({ dal: r.dal, al: r.al, revocato_il: typeof r.revocato_il === "string" ? r.revocato_il : null }, oggi) !== "in_corso") continue;
    totale += Math.min(r.gare, GARE_OMAGGIO_MAX);
  }
  return totale;
}

function giorniTra(dal: string, al: string): number {
  return Math.round((Date.parse(`${al}T12:00:00Z`) - Date.parse(`${dal}T12:00:00Z`)) / 86_400_000);
}

export type EsitoNuovoOmaggio = { ok: true; valori: { gare: number; dal: string; al: string; motivo: string | null } } | { ok: false; errore: string };

// Controllo del modulo della console: gare 1–20, «dal» da oggi in poi, «al» non prima di «dal», al massimo due anni.
export function validaNuovoOmaggio(campi: { gare: string; dal: string; al: string; motivo: string }, oggi: string): EsitoNuovoOmaggio {
  const testoGare = campi.gare.trim();
  const gare = Number(testoGare);
  if (testoGare === "" || !Number.isInteger(gare) || gare < 1 || gare > GARE_OMAGGIO_MAX) return { ok: false, errore: `Le gare in omaggio vanno da 1 a ${GARE_OMAGGIO_MAX}.` };
  const dal = campi.dal.trim() || oggi;
  const al = campi.al.trim();
  if (!giornoValido(dal)) return { ok: false, errore: "La data di inizio non è valida." };
  if (!giornoValido(al)) return { ok: false, errore: "Indica fino a quando vale l'omaggio." };
  if (dal < oggi) return { ok: false, errore: "La data di inizio non può essere nel passato." };
  if (al < dal) return { ok: false, errore: "La data di fine non può essere prima di quella di inizio." };
  if (giorniTra(dal, al) > GIORNI_OMAGGIO_MAX) return { ok: false, errore: "Un omaggio può durare al massimo due anni." };
  const motivo = campi.motivo.trim().slice(0, LIMITE_MOTIVO_OMAGGIO);
  return { ok: true, valori: { gare, dal, al, motivo: motivo === "" ? null : motivo } };
}

// «1 gara in più» / «2 gare in più»
export function testoGareOmaggio(gare: number): string {
  return gare === 1 ? "1 gara in più" : `${gare} gare in più`;
}
