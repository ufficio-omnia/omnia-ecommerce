import { PARAMETRI_STANDARD, type Origine, type PianoLavoroDati, type Quantita } from "@/lib/piano-lavoro-dati";

// Piano di lavoro: tutti i numeri, calcolati dal codice con le STESSE operazioni delle formule dell'Excel
// (piano-lavoro-excel.ts). L'Excel li contiene due volte: come formula (che il cliente può cambiare) e come valore
// in cache (perché le anteprime che non ricalcolano — Drive, telefono — non mostrino celle vuote). La verifica
// ricalcola le formule con un motore indipendente e le confronta con questi numeri.

export const SI = "SI";
export const NO = "NO";

export type RisultatoSede = {
  mqTotali: number;
  oreCalcolate: number;
  oreAllocate: number;
  oreAdottate: number;
  scostamento: number | "n.d.";
};

export type RisultatoOrganico = { quota: number; ore: number; fte: number; oreMese: number };

export type RisultatoMacchinario = { importo: number; quotaDurata: number };

export type RisultatoPianoLavoro = {
  parametri: Record<string, number | null>;
  coefficientiLavorazione: number[][]; // per tipologia, per lavorazione
  coefficientiTipologia: number[];
  sedi: RisultatoSede[];
  totaliSedi: { mq: number; canone: number; oreCalcolate: number; oreDichiarate: number; oreAllocate: number; oreAdottate: number };
  orePresidio: number[];
  subtotaliGruppo: { gruppo: string; ore: number }[];
  orePresidi: number;
  oreSedi: number;
  oreTotali: number;
  dichiarato: number | "n.d.";
  scostamentoOre: number | "n.d.";
  scostamentoPct: number | "n.d.";
  esito: string;
  oreSedeVsCalcolate: number | "n.d.";
  durataMesi: number;
  oreDurata: number;
  oreSettimana: number;
  oreMese: number;
  fte: number;
  organico: RisultatoOrganico[];
  sommaQuote: number;
  oreOrganico: number;
  fteOrganico: number;
  controlloQuote: string;
  clausola: { oreAnnue: number[]; unita: number; oreSettimanali: number; oreAnnueTotali: number; fteUscenti: number; differenzaFte: number };
  macchinari: RisultatoMacchinario[];
  totaleMacchinari: number;
  totaleQuotaDurata: number;
  differenzaBudget: number | "n.d.";
  conteggiOrigine: Record<Origine, number>;
};

export function valoreParametro(dati: PianoLavoroDati, chiave: string): number | null {
  return dati.parametri.find((p) => p.chiave === chiave)?.valore ?? null;
}

// Un valore fisso o il parametro a cui rimanda; un parametro assente vale 0 come una cella vuota in Excel.
export function valoreQuantita(q: Quantita | null, dati: PianoLavoroDati): number {
  if (q === null) return 0;
  if (typeof q === "number") return q;
  return valoreParametro(dati, q.param) ?? 0;
}

const MESSAGGIO_IN_LINEA = "In linea con il monte ore dichiarato";
const MESSAGGIO_FUORI = "Scostamento oltre la tolleranza: verificare";
const MESSAGGIO_NON_DICHIARATO = "Monte ore non dichiarato dal bando";

export function calcolaPianoLavoro(dati: PianoLavoroDati): RisultatoPianoLavoro {
  const parametri: Record<string, number | null> = {};
  for (const p of dati.parametri) parametri[p.chiave] = p.valore;

  // coefficienti ore/mq/anno: frequenza / resa per ogni lavorazione, sommati per tipologia (come SUMIF); una lavorazione
  // già svolta dagli addetti dei presìdi non aggiunge ore (le ore sono nel foglio Presidi)
  const coefficientiLavorazione = dati.tipologie.map((t) =>
    t.lavorazioni.map((l) => (l.esclusaDaMq ? 0 : l.resa !== null && l.resa !== 0 ? valoreQuantita(l.frequenza, dati) / l.resa : 0)),
  );
  const coefficientiTipologia = coefficientiLavorazione.map((c) => c.reduce((s, x) => s + x, 0));

  const monte = parametri[PARAMETRI_STANDARD.monteOreDichiarato];
  const monteNumero = monte !== null && monte !== undefined;
  const sommaCanoni = dati.sedi.reduce((s, x) => s + (x.aCanone && x.canone !== null ? x.canone : 0), 0);

  const sedi: RisultatoSede[] = dati.sedi.map((s) => {
    const mqTotali = dati.tipologie.reduce((acc, t) => acc + (s.mq[t.id] ?? 0), 0);
    const oreCalcolate = dati.tipologie.reduce((acc, t, i) => acc + (s.mq[t.id] ?? 0) * coefficientiTipologia[i], 0);
    const oreAllocate =
      s.aCanone && s.canone !== null && monteNumero && sommaCanoni > 0 ? (s.canone / sommaCanoni) * (monte as number) : 0;
    // priorità: ore dichiarate dalla stazione appaltante, poi ripartizione del monte ore dichiarato per peso del
    // canone, poi il calcolo dalle metrature
    const oreAdottate = !s.aCanone ? 0 : s.oreDichiarate !== null ? s.oreDichiarate : oreAllocate > 0 ? oreAllocate : oreCalcolate;
    const scostamento = oreAdottate > 0 && oreCalcolate > 0 ? oreCalcolate / oreAdottate - 1 : "n.d.";
    return { mqTotali, oreCalcolate, oreAllocate, oreAdottate, scostamento };
  });
  const somma = (f: (s: RisultatoSede, i: number) => number) => sedi.reduce((acc, s, i) => acc + f(s, i), 0);
  const totaliSedi = {
    mq: somma((s) => s.mqTotali),
    canone: sommaCanoni,
    oreCalcolate: somma((s) => s.oreCalcolate),
    oreDichiarate: dati.sedi.reduce((acc, s) => acc + (s.oreDichiarate ?? 0), 0),
    oreAllocate: somma((s) => s.oreAllocate),
    oreAdottate: somma((s) => s.oreAdottate),
  };

  // presìdi: addetti × ore per periodo × periodi, subtotali per gruppo nell'ordine di comparsa
  const orePresidio = dati.presidi.map((p) => valoreQuantita(p.addetti, dati) * valoreQuantita(p.oreAddetto, dati) * valoreQuantita(p.periodi, dati));
  const subtotaliGruppo: { gruppo: string; ore: number }[] = [];
  dati.presidi.forEach((p, i) => {
    const ultimo = subtotaliGruppo[subtotaliGruppo.length - 1];
    if (ultimo && ultimo.gruppo === p.gruppo) ultimo.ore += orePresidio[i];
    else subtotaliGruppo.push({ gruppo: p.gruppo, ore: orePresidio[i] });
  });
  const orePresidi = subtotaliGruppo.reduce((s, g) => s + g.ore, 0);

  const oreSedi = totaliSedi.oreAdottate;
  const oreTotali = oreSedi + orePresidi;
  const dichiarato: number | "n.d." = monteNumero ? (monte as number) : "n.d.";
  const scostamentoOre = typeof dichiarato === "number" ? oreTotali - dichiarato : "n.d.";
  const scostamentoPct = typeof dichiarato === "number" ? (dichiarato === 0 ? 0 : oreTotali / dichiarato - 1) : "n.d.";
  const tolleranza = parametri[PARAMETRI_STANDARD.tolleranza] ?? 0;
  const esito = typeof scostamentoPct === "number" ? (Math.abs(scostamentoPct) <= tolleranza ? MESSAGGIO_IN_LINEA : MESSAGGIO_FUORI) : MESSAGGIO_NON_DICHIARATO;
  const oreSedeVsCalcolate = oreSedi > 0 && totaliSedi.oreCalcolate > 0 ? totaliSedi.oreCalcolate / oreSedi - 1 : "n.d.";

  const durataMesi = parametri[PARAMETRI_STANDARD.durataMesi] ?? 0;
  const settimane = parametri[PARAMETRI_STANDARD.settimaneAnno] ?? 0;
  const oreFte = parametri[PARAMETRI_STANDARD.oreFte] ?? 0;
  const oreDurata = (oreTotali * durataMesi) / 12;
  const oreSettimana = settimane === 0 ? 0 : oreTotali / settimane;
  const oreMese = oreTotali / 12;
  const fte = oreFte === 0 ? 0 : oreTotali / oreFte;

  const organico: RisultatoOrganico[] = dati.organico.map((l) => {
    const quota = l.quota ?? 0;
    const ore = oreTotali * quota;
    return { quota, ore, fte: oreFte === 0 ? 0 : ore / oreFte, oreMese: ore / 12 };
  });
  const sommaQuote = organico.reduce((s, l) => s + l.quota, 0);
  const oreOrganico = organico.reduce((s, l) => s + l.ore, 0);
  const fteOrganico = organico.reduce((s, l) => s + l.fte, 0);
  const controlloQuote = Math.abs(sommaQuote - 1) < 0.0001 ? "OK: le quote sommano 100%" : "Le quote per livello devono sommare 100%";

  const oreAnnueUscenti = dati.personaleUscente.map((p) => (p.oreSettimanali ?? 0) * settimane);
  const oreAnnueTotali = oreAnnueUscenti.reduce((s, x) => s + x, 0);
  const fteUscenti = oreFte === 0 ? 0 : oreAnnueTotali / oreFte;
  const clausola = {
    oreAnnue: oreAnnueUscenti,
    unita: dati.personaleUscente.reduce((s, p) => s + p.unita, 0),
    oreSettimanali: dati.personaleUscente.reduce((s, p) => s + (p.oreSettimanali ?? 0), 0),
    oreAnnueTotali,
    fteUscenti,
    differenzaFte: fteOrganico - fteUscenti,
  };

  const macchinari: RisultatoMacchinario[] = dati.macchinari.map((m) => {
    const importo = (m.quantita ?? 0) * (m.prezzoUnitario ?? 0);
    const quotaDurata = m.vitaUtileMesi !== null ? importo * Math.min(durataMesi / m.vitaUtileMesi, 1) : importo;
    return { importo, quotaDurata };
  });
  const totaleMacchinari = macchinari.reduce((s, m) => s + m.importo, 0);
  const totaleQuotaDurata = macchinari.reduce((s, m) => s + m.quotaDurata, 0);
  const differenzaBudget = dati.budgetMacchinari !== null ? totaleMacchinari - dati.budgetMacchinari : "n.d.";

  return {
    parametri,
    coefficientiLavorazione,
    coefficientiTipologia,
    sedi,
    totaliSedi,
    orePresidio,
    subtotaliGruppo,
    orePresidi,
    oreSedi,
    oreTotali,
    dichiarato,
    scostamentoOre,
    scostamentoPct,
    esito,
    oreSedeVsCalcolate,
    durataMesi,
    oreDurata,
    oreSettimana,
    oreMese,
    fte,
    organico,
    sommaQuote,
    oreOrganico,
    fteOrganico,
    controlloQuote,
    clausola,
    macchinari,
    totaleMacchinari,
    totaleQuotaDurata,
    differenzaBudget,
    conteggiOrigine: contaOrigini(dati),
  };
}

// Quanti dati del piano sono letti dai documenti, ipotizzati o mancanti (alla generazione): per la copertina e
// per il riepilogo mostrato al cliente.
export function contaOrigini(dati: PianoLavoroDati): Record<Origine, number> {
  const c: Record<Origine, number> = { documento: 0, ipotesi: 0, mancante: 0 };
  for (const p of dati.parametri) if (p.chiave !== PARAMETRI_STANDARD.monteOreDichiarato || p.valore !== null) c[p.origine]++;
  for (const t of dati.tipologie) {
    for (const l of t.lavorazioni) {
      c[l.origineResa]++;
      c[l.origineFrequenza]++;
    }
  }
  for (const s of dati.sedi) {
    for (const t of dati.tipologie) {
      const v = s.mq[t.id];
      if (v === null || v === undefined) c.mancante++;
      else c[s.origineMq === "mancante" ? "ipotesi" : s.origineMq]++;
    }
  }
  for (const p of dati.presidi) c[p.origine]++;
  for (const l of dati.organico) c[l.origine]++;
  for (const m of dati.macchinari) c.ipotesi += m.prezzoUnitario === null ? 0 : 1;
  return c;
}

// Elenco leggibile di ciò che manca, per la copertina e per il cliente: sedi senza metrature, rese o frequenze
// non trovate, durata assente, prezzi senza valore.
export function elencoDatiMancanti(dati: PianoLavoroDati): string[] {
  const voci: string[] = [];
  const durata = dati.parametri.find((p) => p.chiave === PARAMETRI_STANDARD.durataMesi);
  if (!durata || durata.valore === null) voci.push("Durata dell'appalto non trovata nei documenti.");
  const senzaMq = dati.sedi.filter((s) => s.aCanone && dati.tipologie.length > 0 && dati.tipologie.every((t) => s.mq[t.id] === null || s.mq[t.id] === undefined));
  if (senzaMq.length > 0) {
    const nomi = senzaMq.slice(0, 6).map((s) => s.nome).join(", ");
    voci.push(`Metrature non trovate per ${senzaMq.length} ${senzaMq.length === 1 ? "sede" : "sedi"} (${nomi}${senzaMq.length > 6 ? ", …" : ""}): celle gialle da compilare nel foglio «Sedi_Superfici».`);
  }
  const senzaResa = dati.tipologie.flatMap((t) => t.lavorazioni.filter((l) => l.resa === null).map((l) => `${t.nome} — ${l.nome}`));
  if (senzaResa.length > 0) voci.push(`Resa non indicata per ${senzaResa.length} ${senzaResa.length === 1 ? "lavorazione" : "lavorazioni"}: celle gialle nel foglio «Rese_Frequenze».`);
  const senzaFreq = dati.tipologie.flatMap((t) => t.lavorazioni.filter((l) => l.frequenza === null).map((l) => `${t.nome} — ${l.nome}`));
  if (senzaFreq.length > 0) voci.push(`Frequenza non indicata per ${senzaFreq.length} ${senzaFreq.length === 1 ? "lavorazione" : "lavorazioni"}: celle gialle nel foglio «Rese_Frequenze».`);
  const senzaPrezzo = dati.macchinari.filter((m) => m.prezzoUnitario === null);
  if (senzaPrezzo.length > 0) voci.push(`Prezzo non disponibile per ${senzaPrezzo.length} ${senzaPrezzo.length === 1 ? "macchinario" : "macchinari"}: da inserire nel foglio «Macchinari».`);
  const parziali = dati.tipologie.flatMap((t) => t.lavorazioni.filter((l) => l.motivoEsclusione === "parte_limitata").map((l) => l.nome));
  if (parziali.length > 0) voci.push(`${parziali.length} ${parziali.length === 1 ? "lavorazione riguarda" : "lavorazioni riguardano"} solo parti limitate delle aree (es. ${parziali.slice(0, 2).join("; ").slice(0, 120)}): non ${parziali.length === 1 ? "è calcolata" : "sono calcolate"} dalle metrature, da stimare a forfait nelle righe libere del foglio «Presidi».`);
  return voci;
}

// Soglia oltre la quale un coefficiente (ore per unità di superficie all'anno) è quasi certamente un errore di impostazione
// (una lavorazione misurata in unità dentro una tipologia in mq, una frequenza sbagliata): serve a segnalarlo, non a correggerlo.
export const SOGLIA_COEFFICIENTE_ANOMALO = 15;

export function elencoAnomalie(dati: PianoLavoroDati): string[] {
  const r = calcolaPianoLavoro(dati);
  const voci: string[] = [];
  dati.tipologie.forEach((t, i) => {
    if (t.unita === "mq" && r.coefficientiTipologia[i] > SOGLIA_COEFFICIENTE_ANOMALO) {
      voci.push(`Coefficiente anomalo per «${t.nome}» (${r.coefficientiTipologia[i].toFixed(1)} ore per ${t.unita}/anno): controllare frequenze e rese nel foglio «Rese_Frequenze».`);
    }
  });
  return voci;
}
