import type { EsitoDirittoCopertina } from "@/lib/copertina-diritto-calcoli";
import { controllaSessioneAcquisto, type EsitoControlloSessione, type ModalitaStripe, type RigaAcquistoPianoLavoro } from "@/lib/piano-lavoro-acquisto-calcoli";

// Acquisto della copertina della relazione tecnica di UNA gara (richiesta dell'utente, 11/11/2026): regole PURE (nessun database, nessuna rete), provate da
// scripts/verifica-copertina-acquisto.ts. Le usano la pagina della gara, l'azione che avvia il pagamento (che ricalcola SEMPRE tutto, mai ciò che arriva
// dal browser), il webhook e il test. Stessa struttura dell'acquisto del piano di lavoro (piano-lavoro-acquisto-calcoli.ts).
//
// Il PREZZO è quello deciso dalla console per quel cliente (impostazioni «a pagamento», copertina-diritto-calcoli.ts) e si fissa al momento del
// pagamento. Una gara si paga una volta sola e dà diritto a fino a 3 generazioni per stile.

// ───── quando si può pagare ─────

// Prove in locale con la chiave Stripe di PROVA: mai in produzione né su Vercel, e solo con la variabile impostata. (Il database è condiviso tra locale e
// produzione: con una chiave di prova nessun cliente deve arrivare a un pagamento che non può completare.)
export function provaAcquistoCopertinaLocaleAttiva(env: Record<string, string | undefined>): boolean {
  if (env.OMNIA_AI_COPERTINA_ACQUISTO_PROVA !== "1") return false;
  if (env.NODE_ENV === "production" || env.VERCEL) return false;
  return true;
}

// Il pagamento è possibile solo con la chiave Stripe REALE di questo ambiente, oppure in una prova in locale con la chiave di prova.
export function acquistoCopertinaDisponibile(c: { modalita: ModalitaStripe; provaLocale: boolean }): boolean {
  if (c.modalita === "reale") return true;
  return c.provaLocale && c.modalita === "prova";
}

// ───── cosa mostra la scheda della gara ─────

export type OffertaCopertina =
  | { stato: "nessuna" }
  // il titolare può comprare adesso
  | { stato: "acquistabile"; prezzoCentesimi: number }
  // l'Ufficio Gare vede che serve l'acquisto, ma compra solo il titolare
  | { stato: "solo_titolare"; prezzoCentesimi: number };

// L'acquisto si offre solo a chi, per questa gara, non ha ancora il diritto perché il servizio è «a pagamento» e il pagamento online è possibile:
// in ogni altro caso (servizio spento, gratis, già pagata, limite raggiunto) pagare non cambierebbe nulla.
export function valutaOffertaCopertina(c: { diritto: EsitoDirittoCopertina; titolare: boolean }): OffertaCopertina {
  const d = c.diritto;
  if (d.ok || d.motivo !== "a_pagamento" || !d.acquistabile || d.prezzoCentesimi === null) return { stato: "nessuna" };
  return c.titolare ? { stato: "acquistabile", prezzoCentesimi: d.prezzoCentesimi } : { stato: "solo_titolare", prezzoCentesimi: d.prezzoCentesimi };
}

// Il parametro con cui Stripe riporta il cliente alla gara
export type RitornoPagamentoCopertina = "pagato" | "annullato" | null;
export function interpretaRitornoCopertina(valore: string | string[] | undefined): RitornoPagamentoCopertina {
  const v = Array.isArray(valore) ? valore[0] : valore;
  return v === "pagato" || v === "annullato" ? v : null;
}

// ───── avvertenze accettate prima del pagamento ─────
//
// Testi approvati dal titolare l'11 novembre 2026 («le clausole sono tutte buone»). Versionato come le avvertenze del piano di lavoro: versione e impronta
// (sha256 del testo canonico) si registrano con l'accettazione del cliente (tabella omnia_ai_copertine_acquisti). Se si cambia anche una sola parola si
// aumenta la versione e si ripete l'approvazione: l'impronta della versione approvata è fissata nel test (scripts/verifica-copertina-acquisto.ts).
//
// PUNTO APERTO PER IL LEGALE: per creare la copertina il documento di gara scelto dal cliente, il titolo, il CIG e i loghi vengono inviati a OpenAI. Prima
// di venderlo, la Privacy policy e la pagina sulla riservatezza devono nominare OpenAI tra i fornitori che trattano i dati (la clausola 4 lo dice al cliente
// al momento dell'acquisto, ma non sostituisce l'informativa).

export const VERSIONE_CONDIZIONI_COPERTINA = 1;

// null = bozza non ancora approvata. Approvata dal titolare per la versione 1 delle clausole.
export const APPROVAZIONE_LEGALE_COPERTINA = { data: "11 novembre 2026", versioneClausole: 1 } as { data: string; versioneClausole: number } | null;

export type ClausolaCopertina = { numero: number; titolo: string; testo: string; specifica: boolean };

export const CLAUSOLE_COPERTINA: ClausolaCopertina[] = [
  {
    numero: 1,
    titolo: "Oggetto del servizio",
    specifica: false,
    testo:
      "La copertina della relazione tecnica è un'immagine grafica in formato A4, fornita come file PNG e PDF, creata con l'ausilio di un sistema di intelligenza artificiale a partire dal disciplinare o dal capitolato indicato dal cliente, dal titolo e dal CIG della gara e dai loghi caricati dal cliente. Il corrispettivo comprende, per la gara indicata, fino a 3 generazioni in stile stilizzato e fino a 3 generazioni in stile realistico; ogni generazione è diversa dalle altre. Il servizio è rivolto a imprese e professionisti.",
  },
  {
    numero: 2,
    titolo: "Natura del risultato",
    specifica: true,
    testo:
      "La copertina è generata in modo automatico e può contenere imprecisioni nei testi, nei loghi o nella grafica. Il cliente la verifica prima di usarla, ne resta il solo responsabile e risponde della correttezza del titolo, del CIG e dei loghi che vi compaiono. OMNIA AI non garantisce un risultato specifico né l'ammissione o l'aggiudicazione della gara.",
  },
  {
    numero: 3,
    titolo: "Loghi e contenuti del cliente",
    specifica: true,
    testo:
      "Il cliente dichiara di avere il diritto di usare i loghi e i documenti che carica (compreso il logo della stazione appaltante) e di poterli elaborare, a questo scopo, con un sistema di intelligenza artificiale, e ne risponde nei confronti di OMNIA AI e dei terzi.",
  },
  {
    numero: 4,
    titolo: "Dati inviati al fornitore del servizio di intelligenza artificiale",
    specifica: false,
    testo:
      "Per creare la copertina vengono inviati a OpenAI, fornitore del servizio di intelligenza artificiale, il documento di gara scelto dal cliente (limitatamente alle prime pagine), il titolo e il CIG della gara e i loghi, come descritto nella Privacy policy. Il cliente sceglie quale documento usare e può evitare l'invio non acquistando il servizio.",
  },
  {
    numero: 5,
    titolo: "Corrispettivo e pagamento",
    specifica: false,
    testo:
      "Il corrispettivo è quello indicato al momento dell'acquisto, IVA inclusa, per la gara indicata. Il pagamento è anticipato, con carta tramite Stripe. Se una generazione non riesce per un errore del servizio, non viene conteggiata e si può riprovare. Una volta pagato, il corrispettivo non è rimborsabile, salvo i casi previsti da norme inderogabili; l'acquisto riguarda una sola gara e non è trasferibile.",
  },
  {
    numero: 6,
    titolo: "Limitazione di responsabilità",
    specifica: true,
    testo:
      "La responsabilità di OMNIA AI per il servizio è limitata, salvo dolo o colpa grave, al corrispettivo pagato. Il cliente resta responsabile dei contenuti dell'offerta, della veridicità dei dati forniti e della presentazione dell'offerta entro i termini del bando.",
  },
];

export const CLAUSOLE_SPECIFICHE_COPERTINA = CLAUSOLE_COPERTINA.filter((c) => c.specifica);

// Il testo canonico su cui si calcola l'impronta: versione, numeri, titoli e testi, nell'ordine.
export function testoCanonicoCondizioniCopertina(): string {
  return [`versione ${VERSIONE_CONDIZIONI_COPERTINA}`, ...CLAUSOLE_COPERTINA.map((c) => `${c.numero}. ${c.titolo}${c.specifica ? " [specifica]" : ""}\n${c.testo}`)].join("\n\n");
}

export const NOTA_CONSOLE_CONDIZIONI_COPERTINA = APPROVAZIONE_LEGALE_COPERTINA
  ? `Condizioni di acquisto della copertina approvate il ${APPROVAZIONE_LEGALE_COPERTINA.data} su indicazione del titolare (clausole, versione ${APPROVAZIONE_LEGALE_COPERTINA.versioneClausole}); se cambi anche una sola parola serve una nuova versione e una nuova approvazione. Resta da aggiornare la Privacy policy: per creare la copertina i dati vanno a OpenAI.`
  : "Le condizioni di acquisto della copertina sono una BOZZA: falle approvare dal legale PRIMA di darla a pagamento a clienti veri (le clausole 2, 3 e 6 si approvano specificamente). Va aggiornata anche la Privacy policy: per creare la copertina i dati vanno a OpenAI.";

// ───── testi per il cliente ─────

export const TESTI_COPERTINA = {
  titoloAvvertenze: "Condizioni di acquisto della copertina",
  dettaglioAcquisto: " Comprende, per questa gara, fino a 3 generazioni in stile stilizzato e fino a 3 in stile realistico.",
  accettaAvvertenze: "Dichiaro di aver letto e accettato le condizioni di acquisto della copertina",
  soloTitolare: (prezzo: string) => `Per il tuo account la copertina di questa gara costa ${prezzo} (IVA inclusa) e la acquista il titolare dell'account dalla pagina della gara. Una volta acquistata potrai generarla anche tu.`,
  pagamentoRicevuto: "Pagamento ricevuto: lo sto confermando. Aggiorna la pagina tra qualche istante e potrai generare la copertina.",
  pagamentoConfermato: "Pagamento confermato: puoi generare la copertina di questa gara.",
  pagamentoAnnullato: "Pagamento annullato: non è stato addebitato nulla.",
} as const;

export function testoApprovazioneSpecificaCopertina(numeri: number[], titoli: string[]): string {
  const elenco = numeri.map((n, i) => `${n} (${titoli[i]})`).join(", ");
  return `Approvo specificamente, ai sensi degli artt. 1341 e 1342 del codice civile, le clausole ${elenco}.`;
}

// ───── il pagamento registrato ─────

export type RigaAcquistoCopertina = {
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

// La richiesta del webhook: la sessione Stripe deve essere QUELLA dell'acquisto e dello stesso cliente (stessa regola dell'acquisto del piano di lavoro).
export function controllaSessioneAcquistoCopertina(
  riga: Pick<RigaAcquistoCopertina, "stripe_session_id" | "user_id">,
  sessione: { id: string; metadata?: { userId?: string } | null },
): EsitoControlloSessione {
  return controllaSessioneAcquisto(riga as Pick<RigaAcquistoPianoLavoro, "stripe_session_id" | "user_id">, sessione);
}
