import { calcolaPianoLavoro, elencoAnomalie, elencoDatiMancanti } from "@/lib/piano-lavoro-calcoli";
import type { PianoLavoroDati } from "@/lib/piano-lavoro-dati";
import { dirittoDaPacchetto } from "@/lib/pacchetti-servizi-calcoli";

// Piano di lavoro dentro la gara: le regole PURE (nessun database, nessuna rete), provate da scripts/verifica-piano-lavoro-gara-omnia-ai.ts.
//   - chi può generare e quando (una generazione per gara; una seconda solo con una proroga dei termini; un errore non conta);
//   - cosa mostra la scheda della gara;
//   - il riepilogo che si conserva insieme al file;
//   - nome e percorso del file.

export type StatoPiano = "in_corso" | "pronto" | "errore";

// Da dove viene il diritto alla generazione, in ordine di precedenza (prima le fonti gratuite): una concessione dalla console, l'abbonamento
// che include il piano di lavoro (per le gare incluse nel piano), la prova gratuita decisa dalla console, l'acquisto singolo della gara,
// un'unità del pacchetto prepagato (si consuma una sola volta per gara), le prove in locale.
export type FonteDiritto = "concessione" | "abbonamento" | "prova" | "acquisto" | "pacchetto" | "sviluppo";

export type RiepilogoPiano = {
  oreTotali: number;
  fte: number;
  // scostamento dal monte ore dichiarato dal bando (null = il bando non lo dichiara)
  scostamentoPct: number | null;
  esito: string;
  sedi: number;
  tipologie: number;
  macchinariVoci: number;
  macchinariTotale: number;
  datiDaDocumenti: number;
  datiIpotesi: number;
  datiMancanti: number;
  documentiLetti: number;
  documentiNonLetti: number;
  // cosa il cliente deve completare o verificare (elenco leggibile, dalla copertina dell'Excel)
  daVerificare: string[];
};

export type PianoRiga = {
  id: string;
  versione: number;
  stato: StatoPiano;
  creata_il: string;
  completata_il: string | null;
  file_nome: string | null;
  errore: string | null;
  riepilogo: RiepilogoPiano | null;
};

export const COLONNE_PIANO = "id, versione, stato, creata_il, completata_il, file_nome, errore, riepilogo";

// Oltre questi minuti una generazione «in corso» si considera interrotta (la pagina ha un tetto di 800 secondi)
export const MINUTI_GENERAZIONE_INTERROTTA = 20;
export const VERSIONI_MASSIME = 2;

export const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// ───── chi può generare ─────

export const MESSAGGI_PIANO = {
  analisiNonCompletata: "Per generare il piano di lavoro servono i dati della gara: carica i documenti e premi prima «Estrai dati con AI» nel riquadro qui sopra.",
  inCorso: "Una generazione del piano di lavoro è già in corso per questa gara: attendi che finisca (può richiedere alcuni minuti).",
  versioniEsaurite: "Il piano di lavoro di questa gara è già stato generato. Una seconda generazione è possibile solo se i documenti indicano una proroga dei termini di presentazione.",
  secondaSoloConProroga: "Una seconda generazione è possibile solo se i documenti indicano una proroga dei termini di presentazione.",
  nonAttivo: "Il piano di lavoro non è ancora attivo per il tuo account.",
} as const;

export type EsitoDirittoPiano =
  // concessioneId: solo per la fonte «concessione» (la riga del piano ricorda quale)
  // consumaUnita: solo per la fonte «pacchetto» e solo se questa gara non ha ancora consumato la sua unità (la seconda generazione per la proroga
  // e la ripetizione dopo un errore non ne consumano un'altra)
  | { ok: true; versione: 1 | 2; fonte: FonteDiritto; riprova: boolean; concessioneId: string | null; consumaUnita: boolean }
  | { ok: false; motivo: "analisi_non_completata" | "gara_bloccata" | "gia_in_corso" | "versioni_esaurite" | "non_attivo"; messaggio: string };

export type ContestoDirittoPiano = {
  // l'analisi dei documenti della gara è finita (estrazione_stato = «completata»)
  analisiCompleta: boolean;
  // la gara è usabile (non bloccata per quota esaurita): se no, il messaggio da mostrare
  garaUsabile: boolean;
  messaggioGaraBloccata?: string;
  piani: Pick<PianoRiga, "versione" | "stato" | "creata_il">[];
  prorogaStato: string | null;
  // una concessione dalla console copre questa gara (l'id della concessione)
  concessioneId: string | null;
  // l'abbonamento attivo include il piano di lavoro e questa gara è una gara del piano (ha consumato una gara del piano)
  abbonamentoCopreGara: boolean;
  // l'account è in prova e la console ha deciso che il piano di lavoro è gratis per lui
  provaGratuita: boolean;
  // esiste un acquisto singolo PAGATO per questa gara (un pagamento confermato da Stripe)
  acquistoPagato: boolean;
  // pacchetto prepagato: le unità residue dell'account e se questa gara ha già consumato la sua (assenti = nessun pacchetto)
  pacchettoSaldo?: number;
  pacchettoGaraConsumata?: boolean;
  // apertura per le prove in locale (mai in produzione)
  aperturaSviluppo: boolean;
  adesso: Date;
};

// Apertura per le prove in locale: mai in produzione, e solo se la variabile è impostata (stessa idea del modello leggero)
export function aperturaSviluppoAttiva(env: Record<string, string | undefined>): boolean {
  if (env.OMNIA_AI_PIANO_LAVORO_APERTO !== "1") return false;
  if (env.NODE_ENV === "production" || env.VERCEL) return false;
  return true;
}

export function generazioneInterrotta(p: Pick<PianoRiga, "stato" | "creata_il">, adesso: Date): boolean {
  if (p.stato !== "in_corso") return false;
  const creata = new Date(p.creata_il).getTime();
  if (!Number.isFinite(creata)) return true;
  return adesso.getTime() - creata > MINUTI_GENERAZIONE_INTERROTTA * 60_000;
}

export function prorogaPresente(prorogaStato: string | null): boolean {
  return prorogaStato === "con_nuova_data" || prorogaStato === "senza_nuova_data";
}

export function valutaDirittoPiano(c: ContestoDirittoPiano): EsitoDirittoPiano {
  if (!c.analisiCompleta) return { ok: false, motivo: "analisi_non_completata", messaggio: MESSAGGI_PIANO.analisiNonCompletata };
  if (!c.garaUsabile) return { ok: false, motivo: "gara_bloccata", messaggio: c.messaggioGaraBloccata ?? MESSAGGI_PIANO.nonAttivo };
  if (c.piani.some((p) => p.stato === "in_corso" && !generazioneInterrotta(p, c.adesso))) return { ok: false, motivo: "gia_in_corso", messaggio: MESSAGGI_PIANO.inCorso };

  const pronti = c.piani.filter((p) => p.stato === "pronto").length;
  if (pronti >= VERSIONI_MASSIME) return { ok: false, motivo: "versioni_esaurite", messaggio: MESSAGGI_PIANO.versioniEsaurite };
  if (pronti === 1 && !prorogaPresente(c.prorogaStato)) return { ok: false, motivo: "versioni_esaurite", messaggio: MESSAGGI_PIANO.versioniEsaurite };

  // la fonte registrata è quella vera: prima le gratuite (concessione, abbonamento, prova), poi l'acquisto della gara (già pagato: non si consuma
  // un'unità del pacchetto per una gara pagata), poi il pacchetto, per ultima l'apertura di sviluppo
  const pacchetto = dirittoDaPacchetto({ saldo: c.pacchettoSaldo ?? 0, garaGiaConsumata: c.pacchettoGaraConsumata ?? false });
  const fonte: FonteDiritto | null = c.concessioneId
    ? "concessione"
    : c.abbonamentoCopreGara
      ? "abbonamento"
      : c.provaGratuita
        ? "prova"
        : c.acquistoPagato
          ? "acquisto"
          : pacchetto.ha
            ? "pacchetto"
            : c.aperturaSviluppo
              ? "sviluppo"
              : null;
  if (!fonte) return { ok: false, motivo: "non_attivo", messaggio: MESSAGGI_PIANO.nonAttivo };

  const versione = (pronti + 1) as 1 | 2;
  // la versione si riprova se l'ultimo tentativo è finito in errore o è rimasto interrotto
  const riprova = c.piani.some((p) => p.versione === versione && (p.stato === "errore" || generazioneInterrotta(p, c.adesso)));
  return { ok: true, versione, fonte, riprova, concessioneId: fonte === "concessione" ? c.concessioneId : null, consumaUnita: fonte === "pacchetto" && pacchetto.consumaUnita };
}

// ───── riepilogo conservato con il file ─────

const arrotonda = (n: number, cifre = 2) => Math.round(n * 10 ** cifre) / 10 ** cifre;

export function costruisciRiepilogo(dati: PianoLavoroDati): RiepilogoPiano {
  const r = calcolaPianoLavoro(dati);
  return {
    oreTotali: arrotonda(r.oreTotali),
    fte: arrotonda(r.fte),
    scostamentoPct: typeof r.scostamentoPct === "number" ? arrotonda(r.scostamentoPct, 4) : null,
    esito: r.esito,
    sedi: dati.sedi.length,
    tipologie: dati.tipologie.length,
    macchinariVoci: dati.macchinari.length,
    macchinariTotale: arrotonda(r.totaleMacchinari),
    datiDaDocumenti: r.conteggiOrigine.documento,
    datiIpotesi: r.conteggiOrigine.ipotesi,
    datiMancanti: r.conteggiOrigine.mancante,
    documentiLetti: dati.documenti.letti.length,
    documentiNonLetti: dati.documenti.nonLetti.length,
    daVerificare: [...elencoDatiMancanti(dati), ...elencoAnomalie(dati), ...dati.avvertenze].slice(0, 12),
  };
}

// Un riepilogo letto dal database (jsonb) può non avere la forma attesa: si accetta solo ciò che torna.
export function riepilogoValido(x: unknown): RiepilogoPiano | null {
  if (typeof x !== "object" || x === null) return null;
  const r = x as Record<string, unknown>;
  const numeri = ["oreTotali", "fte", "sedi", "tipologie", "macchinariVoci", "macchinariTotale", "datiDaDocumenti", "datiIpotesi", "datiMancanti", "documentiLetti", "documentiNonLetti"];
  if (!numeri.every((k) => typeof r[k] === "number" && Number.isFinite(r[k] as number))) return null;
  if (typeof r.esito !== "string") return null;
  return {
    oreTotali: r.oreTotali as number,
    fte: r.fte as number,
    scostamentoPct: typeof r.scostamentoPct === "number" ? r.scostamentoPct : null,
    esito: r.esito,
    sedi: r.sedi as number,
    tipologie: r.tipologie as number,
    macchinariVoci: r.macchinariVoci as number,
    macchinariTotale: r.macchinariTotale as number,
    datiDaDocumenti: r.datiDaDocumenti as number,
    datiIpotesi: r.datiIpotesi as number,
    datiMancanti: r.datiMancanti as number,
    documentiLetti: r.documentiLetti as number,
    documentiNonLetti: r.documentiNonLetti as number,
    daVerificare: Array.isArray(r.daVerificare) ? r.daVerificare.filter((v): v is string => typeof v === "string").slice(0, 12) : [],
  };
}

// ───── nome e percorso del file ─────

export function percorsoFilePiano(garaId: string, versione: number): string {
  return `${garaId}/piano-lavoro-v${versione}.xlsx`;
}

// Nome del file scaricato: sicuro per ogni sistema (niente caratteri vietati, lunghezza limitata)
export function nomeFilePiano(titoloGara: string, versione: number): string {
  const pulito = titoloGara
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .trim();
  return `Piano di lavoro - ${pulito || "gara"} - v${versione}.xlsx`;
}

// L'errore da conservare e mostrare: breve, senza percorsi né chiavi
export function erroreBreve(e: unknown): string {
  const testo = e instanceof Error ? e.message : String(e);
  return testo
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[chiave]")
    .replace(/eyJ[A-Za-z0-9_-]{20,}/g, "[token]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}
