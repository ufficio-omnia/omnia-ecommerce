// Revisione umana della relazione tecnica: regole di prezzo, urgenza e controllo dei contatti.
// Tutto puro (nessun database, nessuna rete): lo usano la pagina, l'azione che avvia il pagamento
// (che ricalcola SEMPRE il prezzo, mai quello arrivato dal browser) e il test.

export const REVISIONE = {
  // da 250 € (fino a 5 pagine) a 550 € (50 o più), in proporzione tra i due estremi
  prezzoBaseCentesimi: 25000,
  pagineBase: 5,
  prezzoMassimoCentesimi: 55000,
  pagineMassimo: 50,
  // Urgenza: ore che mancano alla scadenza della gara, contate dal momento della richiesta.
  //   meno di 48 ore: non gestibile (la consegna richiede 48 ore);
  //   da 48 a meno di 72 ore: +50%;  da 72 a 96 ore: +25%;  oltre 96 ore: nessuna maggiorazione.
  oreMinimePerGestire: 48,
  oreMaggiorazione50: 72,
  oreMaggiorazione25: 96,
  maggiorazione25: 25,
  maggiorazione50: 50,
  // impegni verso il cliente: contatto personale in ore LAVORATIVE, consegna in 48 ore (di calendario)
  oreContattoLavorative: 5,
  oreConsegna: 48,
} as const;

// Le regole di urgenza a parole, uguali per la pagina, il modulo e le condizioni.
export function testoRegoleUrgenza(): string {
  return `Se la gara scade da ${REVISIONE.oreMaggiorazione50} a ${REVISIONE.oreMaggiorazione25} ore dalla richiesta il prezzo sale del ${REVISIONE.maggiorazione25}%; da ${REVISIONE.oreMinimePerGestire} a ${REVISIONE.oreMaggiorazione50} ore sale del ${REVISIONE.maggiorazione50}%. Le gare che scadono tra meno di ${REVISIONE.oreMinimePerGestire} ore non possono essere gestite da consulenti umani.`;
}

// ───── pagine e prezzo ─────

export type FontePagine = "disciplinare" | "relazione";

// Le pagine su cui si calcola il prezzo: in primo luogo quelle che il disciplinare prescrive (limite
// complessivo dell'offerta tecnica); se non ce n'è una, le pagine del Word generato da OMNIA AI come
// relazione tecnica finale (una stima: non c'è modo di contare le pagine reali di un Word fuori da Word).
export function paginePerRevisione(i: { limitePagineDisciplinare: number | null | undefined; pagineStimateRelazione: number | null | undefined }): { pagine: number; fonte: FontePagine } | null {
  const limite = i.limitePagineDisciplinare;
  if (typeof limite === "number" && Number.isFinite(limite) && limite >= 1) return { pagine: Math.ceil(limite), fonte: "disciplinare" };
  const stima = i.pagineStimateRelazione;
  if (typeof stima === "number" && Number.isFinite(stima) && stima > 0) return { pagine: Math.max(1, Math.ceil(stima)), fonte: "relazione" };
  return null;
}

// Prezzo di base in centesimi, a euro interi: proporzionale tra (5 pagine, 250 €) e (50 pagine, 550 €); sotto
// le 5 pagine vale 250 €, da 50 pagine in su 550 €.
export function prezzoBasePerPagine(pagine: number): number {
  const p = Math.min(Math.max(Math.trunc(pagine), REVISIONE.pagineBase), REVISIONE.pagineMassimo);
  const euroBase = REVISIONE.prezzoBaseCentesimi / 100;
  const euroPerPagina = (REVISIONE.prezzoMassimoCentesimi - REVISIONE.prezzoBaseCentesimi) / 100 / (REVISIONE.pagineMassimo - REVISIONE.pagineBase);
  return Math.round(euroBase + (p - REVISIONE.pagineBase) * euroPerPagina) * 100;
}

// ───── urgenza ─────

// La scadenza è il giorno (sempre) e l'ora (se il bando la indica): quando l'ora manca si intende 23:59 di
// quel giorno, ora di Roma.
export const ORA_SCADENZA_PREDEFINITA = "23:59";

// «HH:MM» (anche «H:MM» o «HH:MM:SS», come arriva dalla colonna time del database) → «HH:MM»; altro → null.
export function normalizzaOraScadenza(ora: string | null | undefined): string | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec((ora ?? "").trim());
  if (!m) return null;
  const ore = Number(m[1]);
  const minuti = Number(m[2]);
  if (ore > 23 || minuti > 59) return null;
  return `${String(ore).padStart(2, "0")}:${m[2]}`;
}

function offsetRomaMinuti(istante: Date): number {
  const parti = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Rome", timeZoneName: "shortOffset" }).formatToParts(istante);
  const nome = parti.find((p) => p.type === "timeZoneName")?.value ?? "GMT+1";
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(nome);
  if (!m) return 60;
  const minuti = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return m[1] === "-" ? -minuti : minuti;
}

// L'istante della scadenza: la data e l'ora indicate (ora di Roma). Senza ora, le 23:59:59 di quel giorno.
export function istanteScadenza(data: string | null | undefined, ora?: string | null): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((data ?? "").slice(0, 10));
  if (!m) return null;
  const oraNormale = normalizzaOraScadenza(ora);
  const [h, min, sec] = oraNormale ? [Number(oraNormale.slice(0, 2)), Number(oraNormale.slice(3, 5)), 0] : [23, 59, 59];
  const parete = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), h, min, sec);
  if (!Number.isFinite(parete)) return null;
  // l'ora di Roma si converte in UTC con la differenza in vigore in QUELL'istante (ora legale compresa);
  // si ricalcola una seconda volta per i giorni del cambio d'ora
  let istante = parete - offsetRomaMinuti(new Date(parete)) * 60_000;
  istante = parete - offsetRomaMinuti(new Date(istante)) * 60_000;
  return new Date(istante);
}

// Fine del giorno (23:59:59, ora di Roma): la scadenza di una gara che non indica l'ora.
export function fineGiornoRoma(data: string | null | undefined): Date | null {
  return istanteScadenza(data, null);
}

export function oreAllaScadenza(scadenza: string | null | undefined, adesso: Date, ora?: string | null): number | null {
  const fine = istanteScadenza(scadenza, ora);
  return fine ? (fine.getTime() - adesso.getTime()) / 3_600_000 : null;
}

export type Urgenza =
  | { tipo: "nessuna"; percentuale: 0 }
  // la gara non ha una scadenza registrata: nessuna maggiorazione
  | { tipo: "sconosciuta"; percentuale: 0 }
  | { tipo: "maggiorazione"; percentuale: 25 | 50 }
  | { tipo: "non_gestibile"; percentuale: 0 }
  | { tipo: "scaduta"; percentuale: 0 };

// Meno di 48 ore: non gestibile. Da 48 a meno di 72 ore: +50%. Da 72 a 96 ore: +25%. Oltre 96 ore: nessuna.
export function urgenzaPerOre(ore: number | null): Urgenza {
  if (ore === null) return { tipo: "sconosciuta", percentuale: 0 };
  if (ore <= 0) return { tipo: "scaduta", percentuale: 0 };
  if (ore < REVISIONE.oreMinimePerGestire) return { tipo: "non_gestibile", percentuale: 0 };
  if (ore < REVISIONE.oreMaggiorazione50) return { tipo: "maggiorazione", percentuale: REVISIONE.maggiorazione50 };
  if (ore <= REVISIONE.oreMaggiorazione25) return { tipo: "maggiorazione", percentuale: REVISIONE.maggiorazione25 };
  return { tipo: "nessuna", percentuale: 0 };
}

export type PrezzoRevisione = {
  pagine: number;
  fonte: FontePagine;
  baseCentesimi: number;
  maggiorazionePercentuale: 0 | 25 | 50;
  maggiorazioneCentesimi: number;
  totaleCentesimi: number;
  scadenza: string | null;
  // l'ora indicata dal bando («HH:MM»); null = non indicata (si è usato 23:59)
  scadenzaOra: string | null;
  oreAllaScadenza: number | null;
};

export type EsitoPrezzoRevisione =
  | { ok: true; prezzo: PrezzoRevisione }
  | { ok: false; motivo: "non_gestibile" | "scaduta" | "pagine_non_determinabili"; messaggio: string };

export const MESSAGGIO_NON_GESTIBILE = `Questa gara scade tra meno di ${REVISIONE.oreMinimePerGestire} ore: non può essere gestita da consulenti umani per scadenza troppo ravvicinata.`;
export const MESSAGGIO_SCADUTA = "La scadenza di questa gara è già passata: non è possibile richiedere la revisione umana.";
export const MESSAGGIO_PAGINE_NON_DETERMINABILI = "Non riesco a stabilire il numero di pagine della relazione tecnica: scrivici dalla pagina Supporto e ti aiutiamo.";

export function calcolaPrezzoRevisione(i: {
  scadenza: string | null | undefined;
  // ora di scadenza indicata dal bando, se c'è
  scadenzaOra?: string | null;
  limitePagineDisciplinare: number | null | undefined;
  pagineStimateRelazione: number | null | undefined;
  adesso: Date;
}): EsitoPrezzoRevisione {
  const ore = oreAllaScadenza(i.scadenza, i.adesso, i.scadenzaOra);
  const urgenza = urgenzaPerOre(ore);
  if (urgenza.tipo === "scaduta") return { ok: false, motivo: "scaduta", messaggio: MESSAGGIO_SCADUTA };
  if (urgenza.tipo === "non_gestibile") return { ok: false, motivo: "non_gestibile", messaggio: MESSAGGIO_NON_GESTIBILE };

  const pagine = paginePerRevisione({ limitePagineDisciplinare: i.limitePagineDisciplinare, pagineStimateRelazione: i.pagineStimateRelazione });
  if (!pagine) return { ok: false, motivo: "pagine_non_determinabili", messaggio: MESSAGGIO_PAGINE_NON_DETERMINABILI };

  const base = prezzoBasePerPagine(pagine.pagine);
  // il totale a euro interi
  const totale = Math.round((base * (100 + urgenza.percentuale)) / 100 / 100) * 100;
  return {
    ok: true,
    prezzo: {
      pagine: pagine.pagine,
      fonte: pagine.fonte,
      baseCentesimi: base,
      maggiorazionePercentuale: urgenza.percentuale,
      maggiorazioneCentesimi: totale - base,
      totaleCentesimi: totale,
      scadenza: i.scadenza ? String(i.scadenza).slice(0, 10) : null,
      scadenzaOra: i.scadenza ? normalizzaOraScadenza(i.scadenzaOra) : null,
      oreAllaScadenza: ore,
    },
  };
}

// «Come abbiamo calcolato il prezzo», per la pagina e per le email.
export function descriviFontePagine(fonte: FontePagine): string {
  return fonte === "disciplinare" ? "pagine prescritte dal disciplinare di gara" : "pagine della relazione tecnica generata da OMNIA AI";
}

// ───── contatti del referente ─────

export type ContattiRevisione = { nome: string; email: string; cellulare: string };

export function validaContattiRevisione(i: { nome: unknown; email: unknown; cellulare: unknown }): { ok: true; valori: ContattiRevisione } | { ok: false; errore: string } {
  const nome = String(i.nome ?? "").trim().replace(/\s+/g, " ");
  if (nome.length < 2 || nome.length > 120 || !/\p{L}/u.test(nome)) return { ok: false, errore: "Indica nome e cognome del referente della gara." };

  const email = String(i.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 160) return { ok: false, errore: "Indica un indirizzo email valido per il referente." };

  // numeri con spazi, trattini, punti e parentesi; «00» iniziale = «+»
  let cellulare = String(i.cellulare ?? "").trim().replace(/[\s().-]/g, "");
  if (cellulare.startsWith("00")) cellulare = `+${cellulare.slice(2)}`;
  if (!/^\+?\d{8,15}$/.test(cellulare)) return { ok: false, errore: "Indica un numero di cellulare valido per il referente (con il prefisso se è estero, es. +39 333 1234567)." };

  return { ok: true, valori: { nome, email, cellulare } };
}

// «20/10/2026» oppure «20/10/2026 ore 12:00» (l'ora solo se il bando la indica).
export function testoScadenza(scadenza: string | null | undefined, ora?: string | null): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((scadenza ?? "").slice(0, 10));
  if (!m) return null;
  const oraNormale = normalizzaOraScadenza(ora);
  return `${m[3]}/${m[2]}/${m[1]}${oraNormale ? ` ore ${oraNormale}` : ""}`;
}
