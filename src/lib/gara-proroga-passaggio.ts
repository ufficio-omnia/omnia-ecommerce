import { PROPRIETA_SCADENZA_ESTRAZIONE, dataValida, normalizzaProroga, type RisultatoScadenza } from "@/lib/gara-proroga";
import { normalizzaOraScadenza } from "@/lib/omnia-ai-revisione-calcoli";

// Secondo passaggio, mirato, sulla proroga dei termini di presentazione (OMNIA AI). Funzioni PURE (nessun database, nessun
// modello, nessuna lettura di PDF): le usano src/lib/gara-proroga-secondo-passaggio.ts e i test
// (scripts/verifica-proroga-secondo-passaggio-omnia-ai.ts).
//
// Perché esiste (caso reale SMAC, 29/10/2026): in una gara con 44 documenti la proroga dei termini era disposta nel dispositivo di
// una DETERMINA dirigenziale (n. 471/2026, per altro tema: rettifica del costo della manodopera), senza la nuova data; l'analisi
// generale sui 44 documenti ha risposto «nessuna proroga». Una domanda diretta sui soli documenti pertinenti l'ha trovata. Qui si
// fa la stessa cosa in automatico: si cercano, nel testo dei PDF, le PAGINE che parlano di proroga/rinvio/differimento del termine
// e si chiede al modello di valutare solo quelle (più i documenti-atto senza testo, se piccoli). Il risultato si UNISCE a quello
// dell'analisi generale con regole fisse (unisciEsitiProroga): il passaggio mirato può solo aggiungere una proroga che l'analisi
// generale non aveva visto, mai toglierla.

// ── Quali documenti «sembrano atti» ──────────────────────────────────────────────────────────────────────────────────────

// Nomi di file tipici degli atti che possono spostare un termine: determine, delibere, provvedimenti, decreti, avvisi, rettifiche,
// comunicazioni, chiarimenti, verbali. Il bando, il disciplinare e il capitolato NON sono atti in questo senso (ma se parlano di
// proroga il loro testo li fa scegliere ugualmente).
const NOMI_ATTO = /(determin|delibera|provvediment|decret|ordinanz|avviso|rettific|errata|comunicazion|comunicato|prorog|rinvi|differiment|slittament|variazion|integrazion|verbale|chiariment|faq|nota\b)/;

export function sembraUnAtto(nomeFile: string): boolean {
  const nome = nomeFile.toLowerCase().replace(/\.[a-z0-9]{2,4}$/, "").replace(/[_\-.()]+/g, " ");
  return NOMI_ATTO.test(nome);
}

// ── Ricerca nel testo ────────────────────────────────────────────────────────────────────────────────────────────────────

// Per cercare: niente maiuscole, trattini di sillabazione a fine riga uniti («pro-\nroga» → «proroga»), spazi e a capo ridotti a uno.
export function normalizzaTestoRicerca(testo: string): string {
  return testo
    .replace(/\u00ad/g, "")
    .replace(/(\p{L})-[ \t]*\r?\n[ \t]*(\p{L})/gu, "$1$2")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const VERBO_FORTE = /\b(?:prorog\w*|differi\w*|slittament\w*|posticip\w*|spostament\w*|riapertura dei termini)/g;
const RINVIO_DEL_TERMINE = /\brinvi\w*\s+(?:(?:del|dei|dello|della|delle|di|il|la|lo|i|le)\s+)*(?:termin\w*|scadenz\w*)/g;
const PAROLE_TERMINE = /\b(?:termin\w*|scadenz\w*)/;
const PAROLE_PRESENTAZIONE = /\b(?:offert\w*|presentazion\w*|ricezion\w*|partecipazion\w*)/;
const PAROLE_DISPOSITIVO = /\b(?:dispon\w*|determin\w*|stabilisc\w*|dispositivo|decret\w*)/;

export type EsitoRicercaPassaggio = { trovato: boolean; forza: number };

// Una pagina «suggerisce una proroga» se vicino a una parola come proroga/differimento/slittamento/spostamento (o «rinvio del
// termine») compaiono sia «termine/scadenza» sia «offerta/presentazione/ricezione/partecipazione». Forza: 1 = rinvio del termine;
// 2 = proroga/differimento/...; +1 se la pagina è un dispositivo («si dispone», «determina», «decreta»).
export function suggeriscePassaggioProroga(testo: string): EsitoRicercaPassaggio {
  const t = normalizzaTestoRicerca(testo);
  if (t.length < 20) return { trovato: false, forza: 0 };
  let forza = 0;
  const controlla = (regex: RegExp, valore: number) => {
    for (const m of t.matchAll(regex)) {
      const i = m.index ?? 0;
      const finestra = t.slice(Math.max(0, i - 250), i + 300);
      if (PAROLE_TERMINE.test(finestra) && PAROLE_PRESENTAZIONE.test(finestra)) {
        forza = Math.max(forza, valore);
        return;
      }
    }
  };
  controlla(RINVIO_DEL_TERMINE, 1);
  controlla(VERBO_FORTE, 2);
  if (forza > 0 && PAROLE_DISPOSITIVO.test(t)) forza += 1;
  return { trovato: forza > 0, forza };
}

// ── Cosa mandare al modello ──────────────────────────────────────────────────────────────────────────────────────────────

export type PaginaTesto = { numero: number; testo: string };
export type DocumentoPerPassaggio = {
  indice: number; // posizione nell'elenco cronologico dei documenti dell'analisi (da 1)
  nome: string;
  caricatoIl: string; // ISO
  pagine: PaginaTesto[] | null; // null = testo non leggibile (errore di lettura)
  totalePagine: number;
  byte: number;
};

export const MAX_PAGINE_SCELTE = 16; // pagine che contengono il passaggio (le migliori per punteggio)
export const MAX_PAGINE_TOTALI = 30; // comprese le pagine di contesto (la pagina dopo)
export const MAX_CARATTERI_PAGINA = 5000;
export const MAX_PDF_INTERI = 3; // atti senza testo (scansioni) mandati per intero
export const MAX_PAGINE_PDF_INTERO = 12;
export const MAX_BYTE_PDF_INTERO = 8 * 1024 * 1024;

export type PassaggioScelto = { indice: number; nome: string; pagina: number; testo: string };
export type SelezionePassaggi = { passaggi: PassaggioScelto[]; pdfInteri: number[] };

// Un documento «senza testo» è una scansione (o un PDF di sole immagini): la ricerca nel testo non può trovare niente.
export function eSenzaTesto(d: DocumentoPerPassaggio): boolean {
  if (!d.pagine) return false; // errore di lettura: non lo si tratta come scansione
  const caratteri = d.pagine.reduce((somma, p) => somma + p.testo.trim().length, 0);
  return caratteri < 20 * Math.max(1, d.totalePagine);
}

// Sceglie cosa valutare. Pagine dei documenti con testo che suggeriscono una proroga (punteggio: +3 se il documento sembra un atto,
// + la forza della pagina; a parità decide l'ordine cronologico), al massimo MAX_PAGINE_SCELTE, ciascuna con la pagina successiva
// come contesto, al massimo MAX_PAGINE_TOTALI. In più: atti senza testo (scansioni) piccoli, mandati per intero.
export function selezionaPassaggi(documenti: DocumentoPerPassaggio[]): SelezionePassaggi {
  type Candidata = { doc: DocumentoPerPassaggio; pagina: PaginaTesto; punti: number };
  const candidate: Candidata[] = [];
  const pdfInteri: number[] = [];

  for (const doc of documenti) {
    if (!doc.pagine) continue;
    if (eSenzaTesto(doc)) {
      if (sembraUnAtto(doc.nome) && doc.totalePagine <= MAX_PAGINE_PDF_INTERO && doc.byte <= MAX_BYTE_PDF_INTERO) pdfInteri.push(doc.indice);
      continue;
    }
    for (const pagina of doc.pagine) {
      const esito = suggeriscePassaggioProroga(pagina.testo);
      if (esito.trovato) candidate.push({ doc, pagina, punti: esito.forza + (sembraUnAtto(doc.nome) ? 3 : 0) });
    }
  }

  const migliori = [...candidate]
    .sort((a, b) => b.punti - a.punti || new Date(a.doc.caricatoIl).getTime() - new Date(b.doc.caricatoIl).getTime() || a.doc.indice - b.doc.indice || a.pagina.numero - b.pagina.numero)
    .slice(0, MAX_PAGINE_SCELTE);

  const scelte = new Map<string, PassaggioScelto>();
  const chiave = (indice: number, pagina: number) => `${indice}:${pagina}`;
  const aggiungi = (doc: DocumentoPerPassaggio, pagina: PaginaTesto) => {
    if (scelte.size >= MAX_PAGINE_TOTALI) return;
    const k = chiave(doc.indice, pagina.numero);
    if (!scelte.has(k)) scelte.set(k, { indice: doc.indice, nome: doc.nome, pagina: pagina.numero, testo: pagina.testo.trim().slice(0, MAX_CARATTERI_PAGINA) });
  };
  for (const c of migliori) aggiungi(c.doc, c.pagina);
  for (const c of migliori) {
    const successiva = c.doc.pagine?.find((p) => p.numero === c.pagina.numero + 1);
    if (successiva) aggiungi(c.doc, successiva);
  }

  const passaggi = [...scelte.values()].sort((a, b) => a.indice - b.indice || a.pagina - b.pagina);
  return { passaggi, pdfInteri: pdfInteri.sort((a, b) => a - b).slice(0, MAX_PDF_INTERI) };
}

export function selezioneVuota(s: SelezionePassaggi): boolean {
  return s.passaggi.length === 0 && s.pdfInteri.length === 0;
}

// ── Richiesta al modello ─────────────────────────────────────────────────────────────────────────────────────────────────

export const NOME_STRUMENTO_PROROGA = "valuta_proroga_termini";
export const OPERAZIONE_PROROGA = "estrazione_gara_proroga";

// Stesse voci dell'analisi generale (stato, data, ora, data originaria) con in testa il passaggio e il documento: scrivere prima la
// citazione costringe il modello a ancorare la risposta al testo. La citazione serve solo a questo: non si salva e non si registra.
export const PROPRIETA_STRUMENTO_PROROGA = {
  passaggio: {
    type: "string",
    description:
      "Citazione BREVE (massimo 25 parole, parole del documento) del punto in cui un atto DISPONE la proroga/rinvio/differimento del termine di presentazione dell'offerta di questa gara. Ometti il campo se nessun atto lo dispone.",
  },
  documento: {
    type: "string",
    description: "Numero e nome del documento che contiene quel punto (come nell'elenco). Ometti il campo se non c'è nessuna proroga.",
  },
  proroga_termini: PROPRIETA_SCADENZA_ESTRAZIONE.proroga_termini,
  scadenza: PROPRIETA_SCADENZA_ESTRAZIONE.scadenza,
  scadenza_ora: PROPRIETA_SCADENZA_ESTRAZIONE.scadenza_ora,
  scadenza_originaria: PROPRIETA_SCADENZA_ESTRAZIONE.scadenza_originaria,
} as const;

export const ISTRUZIONI_SECONDO_PASSAGGIO = [
  "Dei documenti di una gara d'appalto ti mostro SOLO i passaggi (pagine) che parlano di proroga, rinvio, differimento o spostamento di un termine, più eventuali atti interi senza testo. Devi stabilire se un atto di QUESTA gara DISPONE davvero la proroga del termine di presentazione dell'offerta.",
  "È una proroga anche se è scritta nel dispositivo di una determina o di un altro provvedimento (per esempio «si dispone la proroga del termine per la presentazione delle offerte»), anche se l'atto tratta principalmente altro (una rettifica del costo della manodopera, di un requisito, del bando), e anche se non usa la parola «proroga» ma sposta di fatto il termine.",
  "Se l'atto dispone la proroga ma dice che la nuova data sarà comunicata, pubblicata o individuata in seguito (con la rettifica del bando, sul portale o sulla piattaforma telematica), la risposta è «senza_nuova_data». Se scrive la nuova data, è «con_nuova_data» e quella data va in «scadenza».",
  "NON è una proroga: una clausola GENERALE o IPOTETICA che prevede la possibilità di prorogare o sospendere il termine in certi casi (per esempio in caso di malfunzionamento della piattaforma, «fino a 48 ore», o «la stazione appaltante può prorogare»), perché non sposta il termine di questa gara; la proroga o il rinvio del CONTRATTO o del servizio in corso («proroga tecnica», art. 106 comma 11); il rinvio della seduta di gara o dell'apertura delle buste; la proroga di termini diversi dalla presentazione dell'offerta (chiarimenti, sopralluogo, iscrizione alla piattaforma); un semplice rimando a un articolo («si rinvia all'art. 5»).",
  "Se più atti spostano il termine, vale il più recente (per data scritta nel documento). Se nessun atto dispone la proroga del termine di presentazione di questa gara, rispondi «nessuna»: nel dubbio, «nessuna».",
].join("\n");

export function testoSecondoPassaggio(selezione: SelezionePassaggi, elenco: { indice: number; nome: string; caricatoIl: string }[], dataCaricamento: (iso: string) => string): string {
  const nomeDi = (indice: number) => elenco.find((d) => d.indice === indice);
  const parti: string[] = [ISTRUZIONI_SECONDO_PASSAGGIO, ""];
  if (selezione.pdfInteri.length > 0) {
    parti.push("Atti interi allegati come PDF (documenti senza testo):");
    for (const i of selezione.pdfInteri) {
      const d = nomeDi(i);
      if (d) parti.push(`- Documento ${i}: ${d.nome} — caricato il ${dataCaricamento(d.caricatoIl)}`);
    }
    parti.push("");
  }
  if (selezione.passaggi.length > 0) {
    parti.push("Passaggi estratti dai documenti (in ordine cronologico di caricamento):");
    let ultimo = -1;
    for (const p of selezione.passaggi) {
      if (p.indice !== ultimo) {
        const d = nomeDi(p.indice);
        parti.push("", `=== Documento ${p.indice}: ${p.nome}${d ? ` — caricato il ${dataCaricamento(d.caricatoIl)}` : ""} ===`);
        ultimo = p.indice;
      }
      parti.push(`[pagina ${p.pagina}]`, p.testo);
    }
  }
  return parti.join("\n");
}

// ── Unione con l'analisi generale ────────────────────────────────────────────────────────────────────────────────────────

// Il passaggio mirato può solo AGGIUNGERE una proroga che l'analisi generale non aveva visto (o la sua data), mai toglierla:
//   - mirato «nessuna» / assente / illeggibile → resta l'analisi generale;
//   - mirato «senza_nuova_data»: se l'analisi generale aveva già una proroga con data, resta quella (la data è nota); altrimenti
//     lo stato diventa «senza_nuova_data» e il resto (data del bando, ora) resta com'è;
//   - mirato «con_nuova_data» e data valida: se l'analisi generale ha un'altra proroga con data, vale la più lontana nel tempo
//     (l'ultima proroga); altrimenti la scadenza è quella del mirato, con la data che c'era prima come «scadenza originaria».
//     Senza una data valida il mirato non basta per dire che la data c'è: si tratta come «senza_nuova_data».
export function unisciEsitiProroga(generale: RisultatoScadenza, mirato: RisultatoScadenza | null | undefined): RisultatoScadenza {
  if (!mirato) return generale;
  const statoGenerale = normalizzaProroga(generale.proroga_termini);
  const statoMirato = normalizzaProroga(mirato.proroga_termini);
  if (!statoMirato || statoMirato === "nessuna") return generale;

  const dataMirato = dataValida(mirato.scadenza);
  const dataGenerale = dataValida(generale.scadenza);

  if (statoMirato === "con_nuova_data" && dataMirato) {
    if (statoGenerale === "con_nuova_data" && dataGenerale && dataGenerale >= dataMirato) return generale;
    const oraMirato = typeof mirato.scadenza_ora === "string" ? normalizzaOraScadenza(mirato.scadenza_ora) : null;
    const dataPrima = statoGenerale === "con_nuova_data" ? dataValida(generale.scadenza_originaria) : dataGenerale;
    return {
      ...generale,
      proroga_termini: "con_nuova_data",
      scadenza: dataMirato,
      scadenza_ora: oraMirato ?? (statoGenerale === "con_nuova_data" ? undefined : generale.scadenza_ora),
      scadenza_originaria: dataValida(mirato.scadenza_originaria) ?? dataPrima ?? undefined,
    };
  }

  // senza_nuova_data (o «con data» senza una data valida)
  if (statoGenerale === "con_nuova_data") return generale;
  return { ...generale, proroga_termini: "senza_nuova_data" };
}
