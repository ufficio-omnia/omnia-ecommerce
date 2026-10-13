import { dataRoma } from "./giorni-lavorativi";

// Periodo di una pagina della console, scelto dall'URL (?p=mese-scorso, oppure
// ?p=personalizzato&dal=2026-09-01&al=2026-09-30). I giorni sono giorni di
// calendario di Roma ("AAAA-MM-GG"): un periodo comincia a mezzanotte di Roma e
// finisce a mezzanotte di Roma del giorno dopo l'ultimo, ESCLUSA. Le query
// usano gli istanti UTC (daIso inclusivo, aIso esclusivo).

export type PresetPeriodo = "mese" | "mese-scorso" | "30g" | "90g" | "anno" | "personalizzato";

export const PRESET_PERIODO: { valore: Exclude<PresetPeriodo, "personalizzato">; etichetta: string }[] = [
  { valore: "mese", etichetta: "Mese corrente" },
  { valore: "mese-scorso", etichetta: "Mese scorso" },
  { valore: "30g", etichetta: "30 giorni" },
  { valore: "90g", etichetta: "90 giorni" },
  { valore: "anno", etichetta: "Anno" },
];

export type Periodo = {
  preset: PresetPeriodo;
  etichetta: string;
  // primo e ultimo giorno inclusi, AAAA-MM-GG
  da: string;
  a: string;
  // istanti UTC: inizio inclusivo, fine ESCLUSIVA
  daIso: string;
  aIso: string;
  giorni: number;
  // il periodo comprende anche giorni non ancora trascorsi (mese corrente, anno)
  inCorso: boolean;
};

const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const GIORNI_MASSIMI = 800;
const FORMATO_GIORNO = /^\d{4}-\d{2}-\d{2}$/;

function aUtc(ymd: string): number {
  const [anno, mese, giorno] = ymd.split("-").map(Number);
  return Date.UTC(anno, mese - 1, giorno);
}

export function giorniTra(da: string, a: string): number {
  return Math.round((aUtc(a) - aUtc(da)) / 86_400_000);
}

export function aggiungiGiorni(ymd: string, n: number): string {
  return new Date(aUtc(ymd) + n * 86_400_000).toISOString().slice(0, 10);
}

function giornoValido(ymd: string | undefined): ymd is string {
  if (!ymd || !FORMATO_GIORNO.test(ymd)) return false;
  return new Date(aUtc(ymd)).toISOString().slice(0, 10) === ymd;
}

function primoDelMese(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

function ultimoDelMese(ymd: string): string {
  const [anno, mese] = ymd.split("-").map(Number);
  return new Date(Date.UTC(anno, mese, 0)).toISOString().slice(0, 10);
}

function mesePrecedente(ymd: string): { da: string; a: string } {
  const ultimo = aggiungiGiorni(primoDelMese(ymd), -1);
  return { da: primoDelMese(ultimo), a: ultimo };
}

function offsetRomaMinuti(istante: Date): number {
  const nome =
    new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Rome", timeZoneName: "longOffset" })
      .formatToParts(istante)
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const trovato = /GMT([+-])(\d{2}):(\d{2})/.exec(nome);
  if (!trovato) return 0;
  return (trovato[1] === "-" ? -1 : 1) * (Number(trovato[2]) * 60 + Number(trovato[3]));
}

// L'istante in cui comincia il giorno `ymd` a Roma. Il cambio d'ora in Italia
// avviene di notte (2:00-3:00), mai a mezzanotte, quindi l'offset a mezzanotte è univoco.
export function mezzanotteRoma(ymd: string): Date {
  const utc = aUtc(ymd);
  const primo = offsetRomaMinuti(new Date(utc));
  const istante = utc - primo * 60_000;
  const secondo = offsetRomaMinuti(new Date(istante));
  return new Date(secondo === primo ? istante : utc - secondo * 60_000);
}

function costruisci(preset: PresetPeriodo, etichetta: string, da: string, a: string, oggi: string): Periodo {
  return {
    preset,
    etichetta,
    da,
    a,
    daIso: mezzanotteRoma(da).toISOString(),
    aIso: mezzanotteRoma(aggiungiGiorni(a, 1)).toISOString(),
    giorni: giorniTra(da, a) + 1,
    inCorso: a >= oggi,
  };
}

function nomeMese(ymd: string): string {
  const mese = MESI[Number(ymd.slice(5, 7)) - 1];
  return `${mese.charAt(0).toUpperCase()}${mese.slice(1)} ${ymd.slice(0, 4)}`;
}

export function calcolaPeriodo(parametri: { p?: string; dal?: string; al?: string }, adesso: Date): Periodo {
  const oggi = dataRoma(adesso);

  if (parametri.p === "personalizzato" && giornoValido(parametri.dal) && giornoValido(parametri.al) && parametri.dal <= parametri.al && giorniTra(parametri.dal, parametri.al) < GIORNI_MASSIMI) {
    return costruisci("personalizzato", `${parametri.dal.split("-").reverse().join("/")} – ${parametri.al.split("-").reverse().join("/")}`, parametri.dal, parametri.al, oggi);
  }

  switch (parametri.p) {
    case "mese-scorso": {
      const { da, a } = mesePrecedente(oggi);
      return costruisci("mese-scorso", nomeMese(da), da, a, oggi);
    }
    case "30g":
      return costruisci("30g", "Ultimi 30 giorni", aggiungiGiorni(oggi, -29), oggi, oggi);
    case "90g":
      return costruisci("90g", "Ultimi 90 giorni", aggiungiGiorni(oggi, -89), oggi, oggi);
    case "anno":
      return costruisci("anno", `Anno ${oggi.slice(0, 4)}`, `${oggi.slice(0, 4)}-01-01`, `${oggi.slice(0, 4)}-12-31`, oggi);
    default:
      return costruisci("mese", `${nomeMese(oggi)} (in corso)`, primoDelMese(oggi), ultimoDelMese(oggi), oggi);
  }
}
