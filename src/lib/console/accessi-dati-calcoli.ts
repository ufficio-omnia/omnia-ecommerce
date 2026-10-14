import { csvCella } from "./fatturazione-calcoli";
import { istanteRoma } from "./periodo";

// Calcoli puri (nessun database) del registro degli accessi ai dati dei clienti di
// OMNIA AI: i quattro casi ammessi, il controllo di una registrazione, la scelta delle
// righe che riguardano un cliente e l'estratto (testo e CSV).
//
// Il registro è quello promesso dalle condizioni di abbonamento (art. 10) e
// dall'Allegato A (art. 4): ogni accesso con data, ora, operatore e motivo; il cliente
// può chiederne l'estratto. Vedi la migrazione 0082.

export const CASI_ACCESSO = ["assistenza_tecnica", "revisione_umana", "manutenzione_sicurezza", "obbligo_di_legge"] as const;
export type CasoAccesso = (typeof CASI_ACCESSO)[number];

// Le etichette ricalcano i quattro casi dell'Allegato A, art. 4 (a-d).
export const ETICHETTA_CASO: Record<CasoAccesso, string> = {
  assistenza_tecnica: "Assistenza tecnica richiesta dal cliente",
  revisione_umana: "Revisione umana acquistata dal cliente",
  manutenzione_sicurezza: "Manutenzione o sicurezza non altrimenti risolvibili",
  obbligo_di_legge: "Obbligo di legge o provvedimento dell'autorità",
};

export const LETTERA_CASO: Record<CasoAccesso, string> = {
  assistenza_tecnica: "a",
  revisione_umana: "b",
  manutenzione_sicurezza: "c",
  obbligo_di_legge: "d",
};

// Solo questi due casi possono riguardare tutti i clienti (un intervento sul database).
// Assistenza e revisione nascono sempre dalla richiesta di un cliente preciso.
export const CASI_GENERALI: readonly CasoAccesso[] = ["manutenzione_sicurezza", "obbligo_di_legge"];

export const MOTIVO_MIN = 10;
export const MOTIVO_MAX = 1000;
export const AMBITO_MIN = 3;
export const AMBITO_MAX = 500;
// Un accesso si può registrare dopo averlo fatto, ma non a distanza di settimane.
export const GIORNI_MASSIMI_RITARDO = 7;
const TOLLERANZA_FUTURO_MS = 2 * 60_000;

export type RigaAccesso = {
  id: string;
  creatoIl: string;
  accessoIl: string;
  operatoreEmail: string;
  clienteId: string | null;
  clienteEmail: string | null;
  tuttiIClienti: boolean;
  caso: CasoAccesso;
  motivo: string;
  ambito: string;
  garaId: string | null;
};

export type RegistrazioneInput = {
  caso: string;
  riguarda: string; // "cliente" | "tutti"
  clienteEmail: string;
  motivo: string;
  ambito: string;
  // facoltativi: giorno (AAAA-MM-GG) e ora (HH:MM) di Roma in cui l'accesso è avvenuto; vuoti = adesso
  data: string;
  ora: string;
  garaId: string;
};

export type RegistrazioneValida = {
  caso: CasoAccesso;
  tuttiIClienti: boolean;
  clienteEmail: string | null;
  motivo: string;
  ambito: string;
  accessoIl: Date;
  garaId: string | null;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const GIORNO = /^\d{4}-\d{2}-\d{2}$/;
const ORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function eCasoAccesso(valore: string): valore is CasoAccesso {
  return (CASI_ACCESSO as readonly string[]).includes(valore);
}

// Controlla i campi del modulo «Registra un accesso». Restituisce i valori puliti o il
// messaggio da mostrare. L'operatore non è tra i campi: viene dalla sessione.
export function validaRegistrazione(input: RegistrazioneInput, adesso: Date): { ok: true; valori: RegistrazioneValida } | { ok: false; errore: string } {
  const caso = input.caso.trim();
  if (!eCasoAccesso(caso)) return { ok: false, errore: "Scegli uno dei quattro casi in cui l'accesso è ammesso." };

  const tuttiIClienti = input.riguarda === "tutti";
  let clienteEmail: string | null = null;
  if (tuttiIClienti) {
    if (!CASI_GENERALI.includes(caso)) {
      return { ok: false, errore: "L'assistenza e la revisione umana nascono dalla richiesta di un cliente: indica quale." };
    }
  } else {
    clienteEmail = input.clienteEmail.trim().toLowerCase();
    if (!EMAIL.test(clienteEmail)) return { ok: false, errore: "Indica l'email del cliente i cui dati hai guardato." };
  }

  const motivo = input.motivo.trim();
  if (motivo.length < MOTIVO_MIN) return { ok: false, errore: `Scrivi il motivo con almeno ${MOTIVO_MIN} caratteri: chi legge l'estratto deve capire perché serviva.` };
  if (motivo.length > MOTIVO_MAX) return { ok: false, errore: `Il motivo è troppo lungo (massimo ${MOTIVO_MAX} caratteri).` };

  const ambito = input.ambito.trim();
  if (ambito.length < AMBITO_MIN) return { ok: false, errore: "Scrivi cosa hai guardato (gara, documenti, tabella…) e con che strumento." };
  if (ambito.length > AMBITO_MAX) return { ok: false, errore: `La descrizione di cosa hai guardato è troppo lunga (massimo ${AMBITO_MAX} caratteri).` };

  const garaId = input.garaId.trim();
  if (garaId !== "" && !UUID.test(garaId)) return { ok: false, errore: "L'identificativo della gara non è valido." };

  // Quando: vuoto = adesso. Altrimenti giorno e ora insieme, di Roma, non nel futuro e
  // non più vecchi di GIORNI_MASSIMI_RITARDO.
  let accessoIl = adesso;
  const data = input.data.trim();
  const ora = input.ora.trim();
  if (data !== "" || ora !== "") {
    if (!GIORNO.test(data) || Number.isNaN(Date.parse(`${data}T00:00:00Z`)) || !ORA.test(ora)) {
      return { ok: false, errore: "Per indicare quando è avvenuto l'accesso servono sia il giorno sia l'ora (oppure lascia vuoti entrambi: vale adesso)." };
    }
    accessoIl = istanteRoma(data, ora);
    if (accessoIl.getTime() > adesso.getTime() + TOLLERANZA_FUTURO_MS) return { ok: false, errore: "Il momento dell'accesso non può essere nel futuro." };
    if (adesso.getTime() - accessoIl.getTime() > GIORNI_MASSIMI_RITARDO * 24 * 3_600_000) {
      return { ok: false, errore: `Un accesso si registra entro ${GIORNI_MASSIMI_RITARDO} giorni: oltre, scrivi nel motivo cosa è successo e lascia vuoto il momento (vale adesso).` };
    }
  }

  return { ok: true, valori: { caso, tuttiIClienti, clienteEmail, motivo, ambito, accessoIl, garaId: garaId === "" ? null : garaId } };
}

// Le righe che riguardano un cliente: quelle scritte per lui (per id o, se l'id manca
// perché l'utente non esisteva più, per email) e gli accessi generali al database, che
// possono aver toccato i dati di tutti. Dal più recente.
export function righeDelCliente(righe: RigaAccesso[], cliente: { id: string; email?: string | null }): RigaAccesso[] {
  const email = cliente.email?.trim().toLowerCase() ?? null;
  return righe
    .filter((r) => r.tuttiIClienti || r.clienteId === cliente.id || (r.clienteId === null && email !== null && r.clienteEmail === email))
    .sort((a, b) => b.accessoIl.localeCompare(a.accessoIl));
}

// ───── Estratto ─────

export type RigaEstratto = {
  accessoIl: string;
  creatoIl: string;
  operatoreEmail: string;
  caso: CasoAccesso;
  riguarda: "cliente" | "tutti";
  motivo: string;
  ambito: string;
  garaId: string | null;
};

export function righeEstratto(righe: RigaAccesso[]): RigaEstratto[] {
  return righe.map((r) => ({
    accessoIl: r.accessoIl,
    creatoIl: r.creatoIl,
    operatoreEmail: r.operatoreEmail,
    caso: r.caso,
    riguarda: r.tuttiIClienti ? "tutti" : "cliente",
    motivo: r.motivo,
    ambito: r.ambito,
    garaId: r.garaId,
  }));
}

// La frase di apertura dell'estratto. Con zero accessi lo dice in modo esplicito: per il
// cliente «nessun accesso» è l'informazione, non un foglio vuoto.
export function frasePrincipaleEstratto(quanti: number, daGenerali: number, periodo: { da: string | null; a: string | null }): string {
  const intervallo = periodo.da && periodo.a ? `dal ${periodo.da} al ${periodo.a}` : periodo.da ? `dal ${periodo.da}` : periodo.a ? `fino al ${periodo.a}` : "in tutto il periodo coperto dal registro";
  if (quanti === 0) return `Nel registro degli accessi non risulta alcun accesso del personale ai documenti e ai contenuti del cliente ${intervallo}.`;
  const generali = daGenerali > 0 ? `, di cui ${daGenerali} ${daGenerali === 1 ? "generale al database" : "generali al database"} (possono aver riguardato i dati di tutti i clienti)` : "";
  return `Nel registro degli accessi risult${quanti === 1 ? "a 1 accesso" : `ano ${quanti} accessi`} del personale ai documenti e ai contenuti del cliente ${intervallo}${generali}.`;
}

const INTESTAZIONI_CSV = ["Data e ora accesso (Roma)", "Registrato il (Roma)", "Operatore", "Caso", "Riguarda", "Motivo", "Cosa è stato guardato", "Gara"];

function dataOraCsv(iso: string): string {
  return new Date(iso).toLocaleString("it-IT", {
    timeZone: "Europe/Rome",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// Separatore «;» e UTF-8 con BOM, come l'esportazione della fatturazione: si apre in
// Excel in italiano con gli accenti giusti. Le celle passano da csvCella, che
// neutralizza le formule (il motivo è testo scritto da una persona).
export function costruisciCsvEstratto(righe: RigaEstratto[]): string {
  const corpo = righe.map((r) =>
    [
      dataOraCsv(r.accessoIl),
      dataOraCsv(r.creatoIl),
      r.operatoreEmail,
      `${LETTERA_CASO[r.caso]}) ${ETICHETTA_CASO[r.caso]}`,
      r.riguarda === "tutti" ? "Accesso generale al database" : "Il cliente",
      r.motivo,
      r.ambito,
      r.garaId ?? "",
    ]
      .map(csvCella)
      .join(";"),
  );
  return `﻿${[INTESTAZIONI_CSV.map(csvCella).join(";"), ...corpo].join("\r\n")}\r\n`;
}

export type FiltroAccessi = { cliente: string; caso: string };

// I filtri della pagina arrivano dall'indirizzo: si accettano solo valori noti.
export function leggiFiltroAccessi(parametri: { cliente?: string; caso?: string }): FiltroAccessi {
  const caso = (parametri.caso ?? "").trim();
  return { cliente: (parametri.cliente ?? "").trim().toLowerCase().slice(0, 200), caso: eCasoAccesso(caso) ? caso : "" };
}
