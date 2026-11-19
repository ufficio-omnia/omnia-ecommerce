// Fase B4 — COPIA STRUTTURALE del contratto delle notifiche email pubblicato da B2 in src/lib/radar/notifiche/tipi.ts
// (VERSIONE_CONTRATTO_NOTIFICHE = 1, ramo feature/tender-intelligence-b4-db, commit 73ea702). Il file di B2 FA FEDE: qui gli stessi tipi e le
// stesse costanti, perché i due rami sono separati fino all'integrazione. scripts/verifica-contratto-email-b4.mjs controlla che i tipi
// siano identici (assegnabili nei due sensi) e le costanti uguali. All'integrazione questo file diventa una sola riga:
//   export * from "@/lib/radar/notifiche/tipi";
// Solo tipi e costanti: nessun database, nessuna rete.

export const VERSIONE_CONTRATTO_NOTIFICHE = 1;

export const CATEGORIE_NOTIFICA = ["nuove_opportunita", "scadenze", "rettifiche"] as const;
export type CategoriaNotifica = (typeof CATEGORIE_NOTIFICA)[number];

export const TIPI_EVENTO = [
  "scadenza_10",
  "scadenza_5",
  "scadenza_1",
  "scadenza_ravvicinata",
  "rettifica",
  "proroga",
  "modifica_scadenza",
  "documenti",
  "annullamento",
  "riepilogo_opportunita",
] as const;
export type TipoEvento = (typeof TIPI_EVENTO)[number];

export const CATEGORIA_DEL_TIPO: Readonly<Record<TipoEvento, CategoriaNotifica>> = {
  scadenza_10: "scadenze",
  scadenza_5: "scadenze",
  scadenza_1: "scadenze",
  scadenza_ravvicinata: "scadenze",
  rettifica: "rettifiche",
  proroga: "rettifiche",
  modifica_scadenza: "rettifiche",
  documenti: "rettifiche",
  annullamento: "rettifiche",
  riepilogo_opportunita: "nuove_opportunita",
};

export const GIORNI_PROMEMORIA = { scadenza_10: 10, scadenza_5: 5, scadenza_1: 1 } as const satisfies Partial<Record<TipoEvento, number>>;

export const MASSIMO_GARE_RIEPILOGO = 20;

export type ScadenzaNota = {
  /** AAAA-MM-GG, Europe/Rome */
  giorno: string;
  /** "HH:MM" Europe/Rome, solo se indicata dalla fonte */
  ora: string | null;
  /** ISO 8601 con fuso, solo se l'ora è indicata */
  istante: string | null;
  /** chi l'ha indicata: la fonte ufficiale, oppure l'impresa stessa per una gara aggiunta a mano */
  origine: "fonte" | "impresa";
};

export type FonteGara = { fonte: string; nome: string };

export type LottoConScadenza = { numero: string; titolo: string | null; cig: string | null; scadenza: ScadenzaNota };

export type GaraEmail = {
  chiave: string;
  proceduraId: string | null;
  aggiuntaId: string | null;
  denominazione: string;
  stazioneAppaltante: string | null;
  cig: string[];
  tipoAvviso: string | null;
  scadenza: ScadenzaNota | null;
  lottiConScadenzeDiverse: LottoConScadenza[];
  luogo: string | null;
  urlScheda: string;
  urlFonteUfficiale: string | null;
  fonti: FonteGara[];
  /** ultimo aggiornamento della gara rilevato dalla fonte: l'email scrive «ultimo aggiornamento rilevato dalla fonte», non «verificata» */
  ultimaVerificaIl: string;
  aggiuntaAMano: boolean;
};

export type ModificaRilevata = {
  campo: "scadenza" | "importo" | "oggetto" | "documenti" | "lotti" | "stato";
  etichetta: string;
  prima: string | null;
  dopo: string | null;
};

export type EvidenzaModifica = {
  fonte: string;
  nomeFonte: string;
  avvisoId: string | null;
  avvisoUrl: string | null;
  pubblicatoIl: string | null;
  rilevatoIl: string;
  affidabilita: "avviso_ufficiale" | "confronto_versioni";
  motivoFonte: string | null;
};

type EventoBase = {
  id: string;
  impresaId: string;
  nomeImpresa: string | null;
  categoria: CategoriaNotifica;
  tipo: TipoEvento;
  versione: string;
  creatoIl: string;
};

export type EventoScadenza = EventoBase & {
  categoria: "scadenze";
  tipo: "scadenza_10" | "scadenza_5" | "scadenza_1" | "scadenza_ravvicinata";
  gara: GaraEmail & { scadenza: ScadenzaNota };
  giorniMancanti: number;
};

export type EventoModifica = EventoBase & {
  categoria: "rettifiche";
  tipo: "rettifica" | "proroga" | "modifica_scadenza" | "documenti" | "annullamento";
  gara: GaraEmail;
  /** vuoto solo per «annullamento» o per un avviso UFFICIALE di modifica senza campi confrontati cambiati: l'email rimanda all'avviso */
  modifiche: ModificaRilevata[];
  evidenza: EvidenzaModifica;
  scadenzaPrecedente: ScadenzaNota | null;
};

export type GaraRiepilogo = GaraEmail & {
  settori: { settore: string; nome: string; sottocategorie: string[] }[];
  perche: string[];
};

export type EventoRiepilogo = EventoBase & {
  categoria: "nuove_opportunita";
  tipo: "riepilogo_opportunita";
  gare: GaraRiepilogo[];
  altreNonIncluse: number;
  urlPerTe: string;
};

export type EventoRadar = EventoScadenza | EventoModifica | EventoRiepilogo;

export type RuoloDestinatario = "titolare" | "ufficio_gare";

export type DestinatarioEmail = {
  userId: string;
  impresaId: string;
  ruolo: RuoloDestinatario;
  email: string;
  nome: string | null;
  urlPreferenze: string;
};

export type EmailComposta = { oggetto: string; html: string; testo: string };

export type ComponiEmailRadar = (evento: EventoRadar, destinatario: DestinatarioEmail) => EmailComposta;
