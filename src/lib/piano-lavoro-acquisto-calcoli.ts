import type { EsitoDirittoPiano } from "@/lib/piano-lavoro-gara-calcoli";

// Acquisto singolo del piano di lavoro di una gara: regole PURE (nessun database, nessuna rete), provate da
// scripts/verifica-piano-lavoro-acquisto-omnia-ai.ts. Le usano la pagina della gara, l'azione che avvia il pagamento
// (che ricalcola SEMPRE tutto, mai ciò che arriva dal browser), il webhook e il test.

// ───── prezzo ─────

// Il prezzo di partenza (IVA inclusa); la console può cambiarlo senza toccare il codice (console_impostazioni).
export const PREZZO_PIANO_LAVORO = {
  predefinitoCentesimi: 7500,
  minimoCentesimi: 100,
  massimoCentesimi: 1_000_000,
} as const;

export const CHIAVE_PREZZO_PIANO_LAVORO = "piano_lavoro_prezzo_singolo_centesimi";
// Interruttore di vendita: spento finché l'admin non decide (come per gli abbonamenti, vedi omnia-ai-vendita.ts)
export const CHIAVE_VENDITA_PIANO_LAVORO = "vendita_piano_lavoro_attiva";

// Il valore salvato: un intero in centesimi nei limiti; qualunque altra cosa = il prezzo del codice.
export function interpretaPrezzoPianoLavoro(valore: string | number | null | undefined): number {
  const testo = typeof valore === "number" ? String(valore) : (valore ?? "").trim();
  if (!/^\d{1,9}$/.test(testo)) return PREZZO_PIANO_LAVORO.predefinitoCentesimi;
  const n = Number(testo);
  return n >= PREZZO_PIANO_LAVORO.minimoCentesimi && n <= PREZZO_PIANO_LAVORO.massimoCentesimi ? n : PREZZO_PIANO_LAVORO.predefinitoCentesimi;
}

// ───── quando si vende ─────

export type ModalitaStripe = "reale" | "prova" | "sconosciuta";

// Prove in locale con la chiave Stripe di PROVA: mai in produzione né su Vercel, e solo con la variabile impostata.
export function provaAcquistoLocaleAttiva(env: Record<string, string | undefined>): boolean {
  if (env.OMNIA_AI_PIANO_LAVORO_ACQUISTO_PROVA !== "1") return false;
  if (env.NODE_ENV === "production" || env.VERCEL) return false;
  return true;
}

// Il pulsante compare (e l'azione procede) solo se:
//  - l'interruttore in console è acceso E la chiave Stripe di questo ambiente è quella REALE (il database è condiviso tra locale e
//    produzione: con una chiave di prova nessun cliente deve arrivare a un pagamento che non può completare); oppure
//  - è una prova in locale con la chiave di prova.
export function venditaPianoLavoroVisibile(c: { interruttore: boolean; modalita: ModalitaStripe; provaLocale: boolean }): boolean {
  if (c.interruttore && c.modalita === "reale") return true;
  return c.provaLocale && c.modalita === "prova";
}

export function interpretaInterruttoreVenditaPianoLavoro(valore: string | null | undefined): boolean {
  return valore === "1";
}

// ───── cosa mostra la scheda della gara ─────

export type OffertaAcquisto =
  | { stato: "nessuna" }
  // il titolare può comprare adesso
  | { stato: "acquistabile"; prezzoCentesimi: number }
  // l'Ufficio Gare vede che serve l'acquisto, ma compra solo il titolare
  | { stato: "solo_titolare"; prezzoCentesimi: number };

// L'acquisto si offre solo a chi non ha già il diritto E il motivo è proprio «non attivo»: se l'analisi non è finita, la gara è bloccata,
// una generazione è in corso o le versioni sono esaurite, pagare non cambierebbe nulla.
export function valutaOffertaAcquisto(c: { diritto: EsitoDirittoPiano; titolare: boolean; venditaAttiva: boolean; prezzoCentesimi: number }): OffertaAcquisto {
  if (c.diritto.ok || c.diritto.motivo !== "non_attivo" || !c.venditaAttiva) return { stato: "nessuna" };
  return c.titolare ? { stato: "acquistabile", prezzoCentesimi: c.prezzoCentesimi } : { stato: "solo_titolare", prezzoCentesimi: c.prezzoCentesimi };
}

// Il parametro con cui Stripe riporta il cliente alla gara
export type RitornoPagamento = "pagato" | "annullato" | null;
export function interpretaRitornoPagamento(valore: string | string[] | undefined): RitornoPagamento {
  const v = Array.isArray(valore) ? valore[0] : valore;
  return v === "pagato" || v === "annullato" ? v : null;
}

// ───── avvertenze accettate prima del pagamento ─────
//
// Testo in vigore, versionato: la versione e l'impronta (sha256 del testo canonico) si registrano insieme all'accettazione del cliente
// (tabella omnia_ai_piani_lavoro_acquisti). Se si cambia anche una sola parola si aumenta la versione.
//
// APPROVATO dal legale dell'azienda il 6 novembre 2026 (versione 1). Se si cambia una parola: nuova versione e nuova approvazione
// (e aggiornare APPROVAZIONE_LEGALE_PIANO_LAVORO in piano-lavoro-testi.ts).

export const VERSIONE_CONDIZIONI_PIANO_LAVORO = 1;

export type ClausolaPianoLavoro = { numero: number; titolo: string; testo: string; specifica: boolean };

export const CLAUSOLE_PIANO_LAVORO: ClausolaPianoLavoro[] = [
  {
    numero: 1,
    titolo: "Oggetto del servizio",
    specifica: false,
    testo:
      "Il piano di lavoro è un file Excel con formule attive e modificabile, generato da OMNIA AI a partire dai documenti caricati per la gara indicata: monte ore per sede e tipologia di ambiente, organico per livello contrattuale, quadratura con il monte ore dichiarato dal bando, macchinari e attrezzature. Il corrispettivo comprende una generazione per ciascuna gara a cui il servizio è associato: la gara acquistata singolarmente oppure, con l'abbonamento che include il piano di lavoro, ogni gara inclusa nel piano; una seconda generazione per la stessa gara è possibile solo se i documenti della gara indicano una proroga dei termini di presentazione. Il servizio è rivolto a imprese e professionisti.",
  },
  {
    numero: 2,
    titolo: "Natura del documento",
    specifica: true,
    testo:
      "Il piano è un dimensionamento di partenza, non un preventivo né un'offerta. Rese, frequenze e quantità indicate come ipotesi sono assunzioni da validare; i dati che i documenti non permettono di ricavare sono lasciati in evidenza da completare. Il cliente verifica e completa il piano prima di usarlo, e ne resta il solo responsabile. Il costo del lavoro non è compreso.",
  },
  {
    numero: 3,
    titolo: "Prezzi di macchinari e attrezzature",
    specifica: false,
    testo:
      "I prezzi di macchinari e attrezzature sono prezzi standard di mercato, IVA esclusa, rilevati da listini di rivenditori e indicati con la data di rilevazione: servono come riferimento e vanno sostituiti con quelli dei fornitori del cliente.",
  },
  {
    numero: 4,
    titolo: "Documenti e risultato",
    specifica: true,
    testo:
      "OMNIA AI elabora i documenti caricati dal cliente; quelli non leggibili o non pertinenti sono elencati nel piano. Il risultato dipende dalla completezza e dalla correttezza dei documenti caricati e può contenere errori o omissioni. OMNIA AI non garantisce l'ammissione, il punteggio o l'aggiudicazione della gara.",
  },
  {
    numero: 5,
    titolo: "Corrispettivo e pagamento",
    specifica: false,
    testo:
      "Il corrispettivo è quello indicato al momento dell'acquisto, IVA inclusa: un importo per la singola gara oppure, per l'abbonamento, il supplemento mensile indicato. Il pagamento è anticipato, con carta tramite Stripe. Se la generazione non riesce per un errore del servizio, non viene conteggiata e si può riprovare.",
  },
  {
    numero: 6,
    titolo: "Limitazione di responsabilità",
    specifica: true,
    testo:
      "La responsabilità di OMNIA AI per il servizio è limitata, salvo dolo o colpa grave, al corrispettivo pagato. Il cliente resta responsabile dei contenuti dell'offerta, della veridicità dei dati forniti e della presentazione dell'offerta entro i termini del bando.",
  },
];

export const CLAUSOLE_SPECIFICHE_PIANO_LAVORO = CLAUSOLE_PIANO_LAVORO.filter((c) => c.specifica);

// Il testo canonico su cui si calcola l'impronta: versione, numeri, titoli e testi, nell'ordine.
export function testoCanonicoCondizioniPianoLavoro(): string {
  return [`versione ${VERSIONE_CONDIZIONI_PIANO_LAVORO}`, ...CLAUSOLE_PIANO_LAVORO.map((c) => `${c.numero}. ${c.titolo}${c.specifica ? " [specifica]" : ""}\n${c.testo}`)].join("\n\n");
}

// ───── il pagamento registrato ─────

export type RigaAcquistoPianoLavoro = {
  id: string;
  user_id: string | null;
  gara_id: string | null;
  gara_titolo: string;
  prezzo_centesimi: number;
  stato: "in_attesa_pagamento" | "pagata";
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
  pagata_il: string | null;
  importo_pagato_centesimi: number | null;
};

// La richiesta del webhook: la sessione Stripe deve essere QUELLA dell'acquisto e dello stesso cliente.
export type EsitoControlloSessione = { ok: true } | { ok: false; motivo: "sessione_diversa" | "cliente_diverso" };

export function controllaSessioneAcquisto(
  riga: Pick<RigaAcquistoPianoLavoro, "stripe_session_id" | "user_id">,
  sessione: { id: string; metadata?: { userId?: string } | null },
): EsitoControlloSessione {
  if (riga.stripe_session_id && riga.stripe_session_id !== sessione.id) return { ok: false, motivo: "sessione_diversa" };
  if (sessione.metadata?.userId && riga.user_id && sessione.metadata.userId !== riga.user_id) return { ok: false, motivo: "cliente_diverso" };
  return { ok: true };
}
