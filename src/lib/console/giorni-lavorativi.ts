// Giorni lavorativi italiani, per la scadenza dei bonifici. Le condizioni di
// vendita (legal/condizioni-vendita-v1.md) dicono che un bonifico non
// accreditato entro sette giorni lavorativi rende l'ordine annullabile: qui si
// calcola quel termine. Sono lavorativi i giorni dal lunedì al venerdì che non
// sono festività nazionali (le dieci fisse più il lunedì dell'Angelo). Nessuna
// festività locale (santo patrono). Le date sono giorni di calendario di Roma,
// scritti "AAAA-MM-GG": il server gira in UTC e un ordine fatto alle 00:30 di
// Roma cadrebbe sul giorno prima.

export const GIORNI_LAVORATIVI_BONIFICO = 7;

// Con questi o meno giorni lavorativi alla scadenza (oggi compreso) l'ordine è "in scadenza".
export const SOGLIA_IN_SCADENZA = 2;

const FESTIVITA_FISSE = ["01-01", "01-06", "04-25", "05-01", "06-02", "08-15", "11-01", "12-08", "12-25", "12-26"];

// Pasqua (calendario gregoriano, algoritmo di Meeus/Jones/Butcher).
function pasqua(anno: number): { mese: number; giorno: number } {
  const a = anno % 19;
  const b = Math.floor(anno / 100);
  const c = anno % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mese = Math.floor((h + l - 7 * m + 114) / 31);
  const giorno = ((h + l - 7 * m + 114) % 31) + 1;
  return { mese, giorno };
}

function aUtc(ymd: string): Date {
  const [anno, mese, giorno] = ymd.split("-").map(Number);
  return new Date(Date.UTC(anno, mese - 1, giorno));
}

function daUtc(data: Date): string {
  return data.toISOString().slice(0, 10);
}

function eFestivo(ymd: string): boolean {
  if (FESTIVITA_FISSE.includes(ymd.slice(5))) return true;
  const anno = Number(ymd.slice(0, 4));
  const { mese, giorno } = pasqua(anno);
  const lunediDellAngelo = new Date(Date.UTC(anno, mese - 1, giorno + 1));
  return daUtc(lunediDellAngelo) === ymd;
}

export function eGiornoLavorativo(ymd: string): boolean {
  const giornoSettimana = aUtc(ymd).getUTCDay();
  return giornoSettimana !== 0 && giornoSettimana !== 6 && !eFestivo(ymd);
}

// Il giorno di calendario di Roma in cui cade un istante.
export function dataRoma(istante: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).format(istante);
}

// Il giorno lavorativo che arriva `n` giorni lavorativi dopo `ymd` (che non conta).
export function aggiungiGiorniLavorativi(ymd: string, n: number): string {
  let corrente = aUtc(ymd);
  let fatti = 0;
  while (fatti < n) {
    corrente = new Date(corrente.getTime() + 86_400_000);
    if (eGiornoLavorativo(daUtc(corrente))) fatti++;
  }
  return daUtc(corrente);
}

// Quanti giorni lavorativi ci sono dopo `da` fino a `a` compreso. Negativo se `a` precede `da`.
export function contaGiorniLavorativi(da: string, a: string): number {
  if (da === a) return 0;
  const segno = a > da ? 1 : -1;
  const [inizio, fine] = segno === 1 ? [da, a] : [a, da];
  let conteggio = 0;
  let corrente = aUtc(inizio);
  const limite = aUtc(fine);
  while (corrente < limite) {
    corrente = new Date(corrente.getTime() + 86_400_000);
    if (eGiornoLavorativo(daUtc(corrente))) conteggio++;
  }
  return conteggio === 0 ? 0 : conteggio * segno;
}

export type StatoScadenzaBonifico = "in_tempo" | "in_scadenza" | "scaduto";

export type ScadenzaBonifico = {
  // giorni lavorativi trascorsi dall'ordine a oggi
  giorniLavorativi: number;
  // ultimo giorno utile (AAAA-MM-GG): il settimo giorno lavorativo dopo l'ordine
  scadenza: string;
  // giorni lavorativi da oggi alla scadenza: 0 = scade oggi, negativo = già scaduto
  giorniRimasti: number;
  stato: StatoScadenzaBonifico;
};

export function scadenzaBonifico(creatoIl: Date, oggi: Date): ScadenzaBonifico {
  const giornoOrdine = dataRoma(creatoIl);
  const giornoOggi = dataRoma(oggi);
  const scadenza = aggiungiGiorniLavorativi(giornoOrdine, GIORNI_LAVORATIVI_BONIFICO);
  // positivo prima della scadenza, 0 il giorno stesso, negativo (o 0 se oggi è un
  // giorno non lavorativo subito dopo) quando è passata
  const giorniRimasti = contaGiorniLavorativi(giornoOggi, scadenza);
  const stato: StatoScadenzaBonifico =
    giornoOggi > scadenza ? "scaduto" : giorniRimasti <= SOGLIA_IN_SCADENZA ? "in_scadenza" : "in_tempo";
  return {
    giorniLavorativi: Math.max(0, contaGiorniLavorativi(giornoOrdine, giornoOggi)),
    scadenza,
    giorniRimasti,
    stato,
  };
}
