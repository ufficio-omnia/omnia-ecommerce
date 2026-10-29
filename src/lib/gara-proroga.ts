import { normalizzaOraScadenza } from "@/lib/omnia-ai-revisione-calcoli";

// Proroga dei termini di presentazione dell'offerta (OMNIA AI). Funzioni PURE (nessun database, nessun modello): le usano
// l'analisi dei documenti (src/app/actions/gara-extraction.ts), la scheda della gara e i test
// (scripts/verifica-documenti-proroga-omnia-ai.ts).
//
// Regola richiesta dall'utente (29/10/2026):
//   1. se nei documenti c'è una proroga dei termini di presentazione, la scadenza della gara è quella della proroga;
//   2. se la proroga c'è ma i documenti non riportano la nuova data (per esempio rimandano al portale), e SOLO allora, il cliente
//      può cambiare a mano la data di scadenza.
// La data inserita a mano resta finché una nuova analisi non trova la data nei documenti (o non trova più la proroga).

export const STATI_PROROGA = ["nessuna", "con_nuova_data", "senza_nuova_data"] as const;
export type StatoProroga = (typeof STATI_PROROGA)[number];

export function normalizzaProroga(valore: unknown): StatoProroga | null {
  return typeof valore === "string" && (STATI_PROROGA as readonly string[]).includes(valore.trim()) ? (valore.trim() as StatoProroga) : null;
}

// Nello schema dello strumento di estrazione: le due voci che c'erano (scadenza, scadenza_ora) con le regole della proroga in
// più, e le due nuove. Il testo che c'era prima resta identico in testa a ogni descrizione.
export const PROPRIETA_SCADENZA_ESTRAZIONE = {
  scadenza: {
    type: "string",
    description:
      "Data di scadenza per la presentazione dell'offerta, formato YYYY-MM-DD. Ometti il campo se non è indicata nei documenti. PROROGA: se nei documenti c'è una proroga (o rinvio, differimento, spostamento) del termine di presentazione dell'offerta che indica una NUOVA data, scrivi qui la data PROROGATA e non quella originaria del bando; se le proroghe sono più di una, vale la più recente (l'ultima in ordine di data scritta nei documenti). Se la proroga c'è ma i documenti NON riportano la nuova data, scrivi la data originaria del bando (se c'è) e segnalalo in 'proroga_termini'.",
  },
  scadenza_ora: {
    type: "string",
    description:
      "Ora di scadenza per la presentazione dell'offerta, formato HH:MM (24 ore, ora italiana), SOLO se i documenti la indicano insieme alla data (es. 'entro le ore 12:00' → '12:00'). Ometti il campo se non è indicata un'ora: non dedurla e non scrivere 23:59 al posto di un'ora mancante. Se una proroga indica anche una nuova ora, usa quella; se la proroga cambia la data senza citare l'ora, vale l'ora del bando solo se questa è indicata.",
  },
  proroga_termini: {
    type: "string",
    enum: [...STATI_PROROGA],
    description:
      "Esito sulla PROROGA del termine di PRESENTAZIONE DELL'OFFERTA (la data entro cui i concorrenti devono consegnare l'offerta). 'nessuna' = nei documenti non c'è nessuna proroga, rinvio, differimento o spostamento di quel termine. 'con_nuova_data' = c'è una proroga/rinvio/differimento/spostamento del termine di presentazione e i documenti scrivono la NUOVA data (che hai riportato in 'scadenza'). 'senza_nuova_data' = c'è una proroga/rinvio/differimento del termine di presentazione ma i documenti NON riportano la nuova data (per esempio dicono che la nuova scadenza è pubblicata sul portale o sulla piattaforma telematica della stazione appaltante, o sarà comunicata in seguito, o la data manca). LA PROROGA PUÒ ESSERE DISPOSTA DA QUALSIASI DOCUMENTO, non solo da un «avviso di proroga»: una determina o un altro provvedimento dirigenziale (anche nel punto del dispositivo, per esempio «si dispone la proroga del termine per la presentazione delle offerte»), una rettifica del bando, un chiarimento, un verbale, anche quando il documento tratta principalmente altro (per esempio la rettifica del costo della manodopera) e anche quando usa parole come rinvio, differimento, slittamento o riapertura dei termini. Se un provvedimento dispone la proroga ma rimanda la nuova data a una successiva rettifica del bando o pubblicazione, è 'senza_nuova_data'. Cerca questi passaggi in TUTTI i documenti, anche in quelli lunghi o dedicati ad altro. NON sono proroghe di questo tipo e vanno trattate come 'nessuna': la «proroga tecnica» o il rinnovo/la proroga del CONTRATTO o del servizio in corso (art. 106 comma 11 del Codice), la durata dell'appalto, il rinvio della seduta di gara o dell'apertura delle buste, la proroga di termini diversi dalla presentazione dell'offerta (richiesta di chiarimenti, sopralluogo, iscrizione alla piattaforma), una clausola GENERALE o IPOTETICA che prevede la possibilità di prorogare o sospendere il termine (per esempio in caso di malfunzionamento della piattaforma, «fino a 48 ore») senza che un atto sposti davvero il termine di questa gara. Se non sei sicuro che si tratti del termine di presentazione dell'offerta, rispondi 'nessuna'.",
  },
  scadenza_originaria: {
    type: "string",
    description:
      "Data di scadenza ORIGINARIA del bando per la presentazione dell'offerta (prima di ogni proroga), formato YYYY-MM-DD. Scrivila SOLO se 'proroga_termini' è 'con_nuova_data' o 'senza_nuova_data' e i documenti la riportano. Ometti il campo negli altri casi.",
  },
} as const;

// «2026-11-30» → «2026-11-30»; ogni altra forma, o una data che non esiste (30 febbraio), o un anno assurdo → null.
export function dataValida(valore: unknown): string | null {
  if (typeof valore !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valore.trim());
  if (!m) return null;
  const anno = Number(m[1]);
  const mese = Number(m[2]);
  const giorno = Number(m[3]);
  if (anno < 2000 || anno > 2100) return null;
  const d = new Date(Date.UTC(anno, mese - 1, giorno));
  if (d.getUTCFullYear() !== anno || d.getUTCMonth() !== mese - 1 || d.getUTCDate() !== giorno) return null;
  return m[0];
}

export type RisultatoScadenza = { scadenza?: unknown; scadenza_ora?: unknown; proroga_termini?: unknown; scadenza_originaria?: unknown };
export type ScadenzaEsistente = { scadenza: string | null; scadenza_ora: string | null; scadenza_manuale: boolean };

export type DecisioneScadenza = {
  scadenza: string | null;
  scadenza_ora: string | null;
  // null = l'analisi non ha risposto sulla proroga (per esempio uno strumento di estrazione di prima)
  proroga_stato: StatoProroga | null;
  scadenza_originaria: string | null;
  scadenza_manuale: boolean;
};

// Cosa salvare dopo un'analisi dei documenti. La data inserita a mano dal cliente si conserva solo se la proroga è ANCORA senza
// nuova data (il cliente l'ha messa proprio perché i documenti non la riportavano): se l'analisi trova la data nei documenti, o
// non trova più nessuna proroga, vale quello che dicono i documenti.
export function decidiScadenza(risultato: RisultatoScadenza, esistente: ScadenzaEsistente | null): DecisioneScadenza {
  const stato = normalizzaProroga(risultato.proroga_termini);

  if (stato === "senza_nuova_data" && esistente?.scadenza_manuale && dataValida(esistente.scadenza)) {
    return {
      scadenza: dataValida(esistente.scadenza),
      scadenza_ora: normalizzaOraScadenza(esistente.scadenza_ora),
      proroga_stato: stato,
      scadenza_originaria: originaria(risultato, stato, dataValida(esistente.scadenza)),
      scadenza_manuale: true,
    };
  }

  const scadenza = dataValida(risultato.scadenza);
  return {
    scadenza,
    // senza una data non c'è un'ora (come prima di questa funzione)
    scadenza_ora: scadenza ? normalizzaOraScadenza(typeof risultato.scadenza_ora === "string" ? risultato.scadenza_ora : null) : null,
    proroga_stato: stato,
    scadenza_originaria: originaria(risultato, stato, scadenza),
    scadenza_manuale: false,
  };
}

function originaria(risultato: RisultatoScadenza, stato: StatoProroga | null, scadenzaInUso: string | null): string | null {
  if (stato !== "con_nuova_data" && stato !== "senza_nuova_data") return null;
  const data = dataValida(risultato.scadenza_originaria);
  return data && data !== scadenzaInUso ? data : null;
}

// Il cliente può cambiare la data SOLO quando i documenti indicano una proroga senza la nuova data.
export function puoModificareScadenza(statoProroga: unknown): boolean {
  return normalizzaProroga(statoProroga) === "senza_nuova_data";
}

export const MESSAGGIO_MODIFICA_NON_CONSENTITA =
  "La scadenza si può cambiare a mano solo quando i documenti indicano una proroga dei termini senza riportare la nuova data.";

export const GIORNI_PASSATO_AMMESSI = 30;
export const GIORNI_FUTURO_AMMESSI = 730;

function giorniTraDate(da: string, a: string): number {
  const [y1, m1, d1] = da.split("-").map(Number);
  const [y2, m2, d2] = a.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

// La data di oggi a Roma come «AAAA-MM-GG» (l'ora del server può essere un'altra).
export function oggiARoma(adesso: Date): string {
  const parti = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).format(adesso);
  return parti;
}

export type EsitoScadenzaManuale = { ok: true; scadenza: string; ora: string | null } | { ok: false; errore: string };

// La data (e l'ora, facoltativa) che il cliente scrive a mano: una data che esiste, né troppo indietro né troppo avanti nel tempo
// (un errore di battitura sull'anno non deve passare), e un'ora valida se c'è.
export function validaScadenzaManuale(input: { data: unknown; ora: unknown }, adesso: Date): EsitoScadenzaManuale {
  const data = dataValida(input.data);
  if (!data) return { ok: false, errore: "Indica una data valida." };

  const differenza = giorniTraDate(oggiARoma(adesso), data);
  if (differenza < -GIORNI_PASSATO_AMMESSI) return { ok: false, errore: `La data è troppo indietro nel tempo (oltre ${GIORNI_PASSATO_AMMESSI} giorni fa): controlla l'anno.` };
  if (differenza > GIORNI_FUTURO_AMMESSI) return { ok: false, errore: "La data è troppo avanti nel tempo: controlla l'anno." };

  const oraGrezza = typeof input.ora === "string" ? input.ora.trim() : "";
  if (oraGrezza === "") return { ok: true, scadenza: data, ora: null };
  const ora = normalizzaOraScadenza(oraGrezza);
  if (!ora) return { ok: false, errore: "L'ora non è valida: usa il formato ore:minuti (per esempio 12:00), oppure lasciala vuota." };
  return { ok: true, scadenza: data, ora };
}

// Testi della scheda della gara (tenuti qui perché i test li controllano).
export const TESTO_PROROGA_CON_DATA = "I documenti indicano una proroga dei termini: la scadenza mostrata è quella della proroga.";
export const TESTO_PROROGA_SENZA_DATA =
  "I documenti indicano una proroga dei termini di presentazione ma non riportano la nuova data (per esempio rimandano al portale della stazione appaltante). Se conosci la nuova scadenza, inseriscila tu.";
