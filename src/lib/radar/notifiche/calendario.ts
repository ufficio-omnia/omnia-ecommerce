// Fase B4 (19/11/2026, B2) — calendario delle scadenze delle notifiche email. Logica PURA: nessun database, nessuna rete, nessun orologio
// (oggi e gli istanti arrivano come argomenti).
//
// Regole (decisione dell'utente del 19/11, documenti 26, 26B e approvazione definitiva):
//   - giorni di CALENDARIO a Roma (Europe/Rome), calcolati sulle DATE, mai sottraendo istanti (i giorni del cambio d'ora durano 23 o 25 ore);
//   - promemoria a 10, 5 e 1 giorno per OGNI scadenza distinta realmente conosciuta (modifica 2): i lotti con la stessa scadenza si
//     raggruppano; i lotti senza una scadenza indicata non ne ricevono una «comune» inesistente;
//   - nessun recupero per le gare entrate nella lista dopo l'inizio del giorno della soglia; un giro saltato si recupera per al più 2 giorni,
//     solo il promemoria più urgente, solo se manca ancora almeno 1 giorno (D-E12);
//   - una versione di scadenza si annulla solo quando NESSUN gruppo della gara ha più quella scadenza.
// L'ora non si presume mai: l'istante c'è solo se la fonte indica l'ora.

import { GIORNI_PROMEMORIA, versioneScadenza, type GruppoScadenza, type LottoEmail, type ScadenzaNota } from "./tipi";

const FUSO = "Europe/Rome";
const GIORNO = /^\d{4}-\d{2}-\d{2}$/;

/** Il giorno di calendario a Roma di un istante (AAAA-MM-GG). */
export function giornoRoma(istante: Date | string): string {
  const d = typeof istante === "string" ? new Date(istante) : istante;
  const parti = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const v = (t: string) => parti.find((p) => p.type === t)?.value ?? "";
  return `${v("year")}-${v("month")}-${v("day")}`;
}

/** L'ora a Roma di un istante, «HH:MM». */
export function oraRoma(istante: Date | string): string {
  const d = typeof istante === "string" ? new Date(istante) : istante;
  const parti = new Intl.DateTimeFormat("en-GB", { timeZone: FUSO, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const v = (t: string) => parti.find((p) => p.type === t)?.value ?? "";
  return `${v("hour")}:${v("minute")}`;
}

/** Giorni di calendario da `da` ad `a` (date AAAA-MM-GG), sulle sole date: indipendente dai cambi d'ora. */
export function giorniDiCalendario(da: string, a: string): number {
  if (!GIORNO.test(da) || !GIORNO.test(a)) throw new Error(`data non valida: ${da} / ${a}`);
  const utc = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Math.round((utc(a) - utc(da)) / 86_400_000);
}

/** Una data AAAA-MM-GG più `n` giorni di calendario. */
export function aggiungiGiorni(giorno: string, n: number): string {
  const d = new Date(Date.UTC(Number(giorno.slice(0, 4)), Number(giorno.slice(5, 7)) - 1, Number(giorno.slice(8, 10)) + n));
  return d.toISOString().slice(0, 10);
}

/** Una scadenza letta dall'archivio (radar_procedure o radar_lotti, 0114): giorno sempre; istante solo con l'ora indicata. */
export type ScadenzaArchivio = { giorno: string | null; istante: string | null; oraIndicata: boolean };

/** Dalla scadenza dell'archivio alla scadenza nota del contratto; null se il giorno non c'è. Mai un'ora senza «oraIndicata». */
export function scadenzaNota(s: ScadenzaArchivio | null, origine: ScadenzaNota["origine"] = "fonte"): ScadenzaNota | null {
  if (!s?.giorno || !GIORNO.test(s.giorno)) return null;
  const istante = s.oraIndicata && s.istante ? new Date(s.istante).toISOString() : null;
  return { giorno: s.giorno, ora: istante ? oraRoma(istante) : null, istante, origine };
}

export type LottoArchivio = LottoEmail & { scadenza: ScadenzaArchivio | null };

/**
 * Le scadenze distinte conosciute di una gara, ognuna con i suoi lotti (modifica 2).
 *   - Se ALMENO un lotto ha una scadenza propria: un gruppo per ogni scadenza distinta dei lotti (ambito «lotti»); i lotti senza scadenza
 *     finiscono in `lottiSenzaScadenza`, SENZA ricevere la scadenza della procedura o di altri lotti.
 *   - Se nessun lotto ha una scadenza propria: la scadenza della procedura, se c'è, in un solo gruppo (ambito «procedura», nessun lotto
 *     elencato come se l'avesse dichiarata).
 * Gruppi ordinati dalla scadenza più vicina; lotti in ordine di numero.
 */
export function gruppiScadenza(
  procedura: ScadenzaArchivio | null,
  lotti: readonly LottoArchivio[],
  origine: ScadenzaNota["origine"] = "fonte",
): { gruppi: GruppoScadenza[]; lottiSenzaScadenza: LottoEmail[] } {
  const conScadenza = lotti.map((l) => ({ l, s: scadenzaNota(l.scadenza, origine) })).filter((x): x is { l: LottoArchivio; s: ScadenzaNota } => x.s !== null);
  const lotto = (l: LottoArchivio): LottoEmail => ({ numero: l.numero, titolo: l.titolo, cig: l.cig });
  const perNumero = (a: LottoEmail, b: LottoEmail) => (a.numero ?? "").localeCompare(b.numero ?? "", "it", { numeric: true });
  if (conScadenza.length > 0) {
    const mappa = new Map<string, GruppoScadenza>();
    for (const { l, s } of conScadenza) {
      const v = versioneScadenza(s);
      const g = mappa.get(v) ?? { scadenza: s, ambito: "lotti" as const, lotti: [] };
      g.lotti.push(lotto(l));
      mappa.set(v, g);
    }
    const gruppi = [...mappa.values()].map((g) => ({ ...g, lotti: [...g.lotti].sort(perNumero) }));
    gruppi.sort((a, b) => ordineScadenza(a.scadenza, b.scadenza));
    const senza = lotti.filter((l) => !scadenzaNota(l.scadenza, origine)).map(lotto).sort(perNumero);
    return { gruppi, lottiSenzaScadenza: senza };
  }
  const p = scadenzaNota(procedura, origine);
  return { gruppi: p ? [{ scadenza: p, ambito: "procedura", lotti: [] }] : [], lottiSenzaScadenza: [] };
}

/** Ordine tra due scadenze: prima per giorno; nello stesso giorno, quella senza ora dopo quella con l'ora, poi per istante. */
function ordineScadenza(a: ScadenzaNota, b: ScadenzaNota): number {
  if (a.giorno !== b.giorno) return a.giorno < b.giorno ? -1 : 1;
  if (a.istante && b.istante) return Date.parse(a.istante) - Date.parse(b.istante);
  if (a.istante) return -1;
  if (b.istante) return 1;
  return 0;
}

/** Le versioni di scadenza attive di una gara (per gli annullamenti). */
export function versioniAttive(gruppi: readonly GruppoScadenza[]): Set<string> {
  return new Set(gruppi.map((g) => versioneScadenza(g.scadenza)));
}

/**
 * Gli eventi di scadenza da annullare dopo una proroga o un cambio: quelli la cui versione non è più la scadenza di NESSUN gruppo della gara.
 * Se un lotto viene prorogato ma un altro lotto ha ancora la vecchia scadenza, i promemoria di quella scadenza restano.
 */
export function versioniDaAnnullare(versioniEventi: Iterable<string>, gruppiCorrenti: readonly GruppoScadenza[]): string[] {
  const attive = versioniAttive(gruppiCorrenti);
  return [...new Set(versioniEventi)].filter((v) => !attive.has(v));
}

export type PromemoriaDovuto = { tipo: keyof typeof GIORNI_PROMEMORIA; gruppo: GruppoScadenza; giorniMancanti: number; versione: string; recupero: boolean };

/**
 * I promemoria che nascono OGGI per una gara della lista di un'impresa.
 *   - `oggi`: giorno di Roma del giro; `entrataInListaIl`: istante in cui la gara è entrata nella lista (salvata o monitorata);
 *   - `ultimoGiroRiuscito`: giorno di Roma dell'ultimo giro «eventi» riuscito (null = nessuno: nessun recupero).
 * Per ogni gruppo: il promemoria della soglia che cade oggi; oppure, se i giri di 1 o 2 giorni fa sono saltati, il SOLO promemoria più
 * urgente tra le soglie cadute in quei giorni, se la gara era già nella lista all'inizio di quel giorno e manca ancora almeno 1 giorno.
 */
export function promemoriaDovuti(x: {
  oggi: string;
  gruppi: readonly GruppoScadenza[];
  entrataInListaIl: string;
  ultimoGiroRiuscito: string | null;
  aperta: boolean;
}): PromemoriaDovuto[] {
  if (!x.aperta) return [];
  const entrata = giornoRoma(x.entrataInListaIl);
  const esito: PromemoriaDovuto[] = [];
  const soglie = Object.entries(GIORNI_PROMEMORIA) as [keyof typeof GIORNI_PROMEMORIA, number][];
  for (const g of x.gruppi) {
    const mancanti = giorniDiCalendario(x.oggi, g.scadenza.giorno);
    if (mancanti < 1) continue;
    const versione = versioneScadenza(g.scadenza);
    // la gara doveva essere nella lista PRIMA dell'inizio del giorno della soglia: entrata in un giorno precedente
    const eraInLista = (giornoSoglia: string) => entrata < giornoSoglia;
    const diOggi = soglie.find(([, n]) => n === mancanti);
    if (diOggi && eraInLista(x.oggi)) {
      esito.push({ tipo: diOggi[0], gruppo: g, giorniMancanti: mancanti, versione, recupero: false });
      continue;
    }
    if (!x.ultimoGiroRiuscito) continue;
    const saltati = giorniDiCalendario(x.ultimoGiroRiuscito, x.oggi) - 1; // giorni senza giro tra l'ultimo riuscito e oggi
    if (saltati < 1 || saltati > 2) continue;
    // soglie cadute nei giorni saltati (da ieri indietro), la più urgente = quella con meno giorni
    const cadute = soglie
      .map(([tipo, n]) => ({ tipo, n, giorno: aggiungiGiorni(g.scadenza.giorno, -n) }))
      .filter((s) => giorniDiCalendario(s.giorno, x.oggi) >= 1 && giorniDiCalendario(s.giorno, x.oggi) <= saltati && eraInLista(s.giorno))
      .sort((a, b) => a.n - b.n);
    if (cadute.length) esito.push({ tipo: cadute[0].tipo, gruppo: g, giorniMancanti: mancanti, versione, recupero: true });
  }
  return esito;
}
