import { contestoDellaGara, togliRiferimentiAdAltreGare } from "@/lib/piano-lavoro-riservatezza";

// Piano di lavoro (OMNIA AI): il modello dati da cui si costruisce l'Excel.
//
// Il modello di linguaggio LEGGE i documenti di gara e riempie questa struttura (con la fonte e lo stato di ogni
// dato); NON scrive formule né calcola numeri: lo fa il codice (piano-lavoro-calcoli.ts e piano-lavoro-excel.ts).
// Per questo ciò che arriva dal modello passa sempre da normalizzaPianoLavoro, che lo riporta a una forma sicura
// (numeri finiti, nomi unici, limiti di grandezza) prima che qualunque formula lo veda.
//
// La forma è la stessa per ogni gara di pulizia anche se i piani fatti a mano hanno impianti diversi (per
// impianto, per area omogenea, per immobile, a presìdi fissi): tipologie di ambiente con le loro lavorazioni (resa
// e frequenza), sedi con le metrature per tipologia, presìdi e attività a forfait, ripartizione per livello,
// macchinari.

// Da dove viene un dato: letto nei documenti di gara, ipotesi di OMNIA AI da validare, oppure assente nei documenti
// (cella gialla da compilare). Mai un dato inventato spacciato per letto.
export type Origine = "documento" | "ipotesi" | "mancante";

// Un valore fisso, oppure il riferimento a un parametro del foglio «Parametri» (es. i giorni lavorativi all'anno):
// in Excel diventa una formula, così cambiando il parametro si aggiorna tutto.
export type Quantita = number | { param: string };

export type Appalto = {
  titolo: string;
  stazioneAppaltante: string;
  cig: string | null;
  riferimentoGara: string | null;
  criterio: string | null;
  importoBase: number | null;
};

export type Parametro = {
  chiave: string;
  etichetta: string;
  valore: number | null;
  unita: string;
  origine: Origine;
  fonte: string;
};

export type Lavorazione = {
  nome: string;
  // mq/h (o unità/h): senza resa il coefficiente vale 0 e la cella resta da compilare
  resa: number | null;
  // interventi all'anno
  frequenza: Quantita | null;
  notaFrequenza: string;
  origineResa: Origine;
  origineFrequenza: Origine;
  fonte: string;
  // true = la lavorazione non si calcola dalle metrature: perché è svolta dagli addetti dei presìdi fissi (foglio
  // Presidi: le ore sono già lì) oppure perché riguarda solo parti limitate dell'area (lampadari, corrimano, maniglie…) e
  // superficie × frequenza ÷ resa la sovrastimerebbe: in quel caso va stimata a forfait
  esclusaDaMq: boolean;
  motivoEsclusione: "presidio" | "parte_limitata" | "";
};

export type Tipologia = {
  id: string;
  nome: string;
  // «mq» salvo casi particolari (es. «unità» per le emettitrici di biglietti)
  unita: string;
  lavorazioni: Lavorazione[];
};

export type Sede = {
  id: string;
  nome: string;
  indirizzo: string;
  // per tipologia: numero = metratura (0 = non presente), null = dato mancante nei documenti
  mq: Record<string, number | null>;
  origineMq: Origine;
  // false = pulizie a misura / extra canone: non entrano nel monte ore a canone
  aCanone: boolean;
  canone: number | null;
  // ore annue dichiarate dalla stazione appaltante per questa sede (scheda impianto), se esistono
  oreDichiarate: number | null;
  fonte: string;
};

// Presìdi fissi e attività a forfait: ore = addetti × ore per periodo × periodi all'anno.
export type Presidio = {
  gruppo: string;
  descrizione: string;
  addetti: Quantita | null;
  oreAddetto: Quantita | null;
  periodi: Quantita | null;
  origine: Origine;
  fonte: string;
};

export type LivelloOrganico = {
  livello: string;
  ruolo: string;
  // quota del monte ore (0..1)
  quota: number | null;
  origine: Origine;
  fonte: string;
};

export type PersonaleUscente = {
  livello: string;
  unita: number;
  oreSettimanali: number | null;
  nota: string;
};

// I prezzi sono SEMPRE standard di mercato (catalogo di riferimento o ricerca), da sostituire con quelli dei
// fornitori del cliente: l'origine dice solo da dove vengono.
export type OrigineMacchinario = "catalogo" | "ricerca_web" | "ipotesi";

export type Macchinario = {
  categoria: string;
  descrizione: string;
  riferimento: string;
  quantita: number | null;
  prezzoUnitario: number | null;
  vitaUtileMesi: number | null;
  origine: OrigineMacchinario;
  fontePrezzo: string;
  nota: string;
};

export type PianoLavoroDati = {
  versioneSchema: 1;
  appalto: Appalto;
  parametri: Parametro[];
  tipologie: Tipologia[];
  sedi: Sede[];
  presidi: Presidio[];
  organico: LivelloOrganico[];
  personaleUscente: PersonaleUscente[];
  macchinari: Macchinario[];
  budgetMacchinari: number | null;
  // note sui dati mancanti o dubbi, in chiaro, per la copertina
  avvertenze: string[];
  // quali documenti di gara sono stati letti e quali no (con il motivo): il cliente deve poter vedere cosa ha
  // alimentato il piano e cosa è stato lasciato fuori
  documenti: { letti: string[]; nonLetti: { nome: string; motivo: string }[] };
};

export const PARAMETRI_STANDARD = {
  durataMesi: "durata_mesi",
  giorniAnno: "giorni_anno",
  settimaneAnno: "settimane_anno",
  oreFte: "ore_fte",
  monteOreDichiarato: "monte_ore_dichiarato",
  tolleranza: "tolleranza_quadratura",
} as const;

const DEFAULT_PARAMETRI: Parametro[] = [
  { chiave: PARAMETRI_STANDARD.durataMesi, etichetta: "Durata dell'appalto", valore: null, unita: "mesi", origine: "mancante", fonte: "Bando / capitolato" },
  { chiave: PARAMETRI_STANDARD.giorniAnno, etichetta: "Giorni di calendario all'anno", valore: 365, unita: "giorni", origine: "documento", fonte: "Calendario" },
  { chiave: PARAMETRI_STANDARD.settimaneAnno, etichetta: "Settimane all'anno", valore: 52, unita: "settimane", origine: "documento", fonte: "Calendario" },
  { chiave: PARAMETRI_STANDARD.oreFte, etichetta: "Ore produttive annue per addetto a tempo pieno (FTE)", valore: 1573, unita: "ore/anno", origine: "ipotesi", fonte: "Ipotesi di prassi: da allineare alla tabella del costo del lavoro" },
  { chiave: PARAMETRI_STANDARD.monteOreDichiarato, etichetta: "Monte ore annuo dichiarato dal bando (se indicato)", valore: null, unita: "ore/anno", origine: "documento", fonte: "Facoltativo: se il bando indica un monte ore, inseriscilo per la quadratura" },
  { chiave: PARAMETRI_STANDARD.tolleranza, etichetta: "Tolleranza di quadratura sul monte ore dichiarato", valore: 0.05, unita: "%", origine: "ipotesi", fonte: "Ipotesi: oltre questa soglia il riepilogo segnala lo scostamento" },
];

export const LIMITI = {
  tipologie: 24,
  lavorazioniPerTipologia: 12,
  sedi: 300,
  presidi: 150,
  livelli: 12,
  personaleUscente: 40,
  macchinari: 80,
  parametriExtra: 20,
  avvertenze: 30,
  documenti: 400,
} as const;

export const CATEGORIE_MACCHINARI_STANDARD = ["Macchinari", "Attrezzature"] as const;

// ───── normalizzazione di ciò che arriva dal modello ─────

type Json = Record<string, unknown>;
const isObj = (x: unknown): x is Json => typeof x === "object" && x !== null && !Array.isArray(x);
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);

function numero(x: unknown): number | null {
  if (typeof x === "number") return Number.isFinite(x) && x >= 0 ? x : null;
  if (typeof x === "string") {
    const t = x.trim().replace(/\s/g, "");
    if (!t) return null;
    // «1.234,56» (italiano) oppure «1234.56»
    const n = Number(/,/.test(t) ? t.replace(/\./g, "").replace(",", ".") : t);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  return null;
}

// Testo per una cella: senza caratteri di controllo, con una lunghezza massima e senza segni che Excel
// leggerebbe come formula all'inizio della cella.
export function testoSicuro(x: unknown, max = 200): string {
  if (typeof x !== "string" && typeof x !== "number") return "";
  const t = String(x).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/\s+/g, " ").trim().replace(/^[=+@]+/, "").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

// Nome di tipologia: niente caratteri jolly di SUMIF (* ? ~) né operatori all'inizio, che cambierebbero il criterio.
function nomeSicuro(x: unknown, max = 80): string {
  return testoSicuro(x, max).replace(/[*?~]/g, "").replace(/^[<>]+/, "").trim();
}

function origine(x: unknown, predefinita: Origine): Origine {
  return x === "documento" || x === "ipotesi" || x === "mancante" ? x : predefinita;
}

function quantita(x: unknown, chiaviParametri: Set<string>): Quantita | null {
  if (isObj(x) && typeof x.param === "string") return chiaviParametri.has(x.param) ? { param: x.param } : null;
  return numero(x);
}

function univoco(nome: string, usati: Set<string>): string {
  let candidato = nome || "Senza nome";
  let n = 2;
  while (usati.has(candidato.toLowerCase())) candidato = `${nome || "Senza nome"} (${n++})`;
  usati.add(candidato.toLowerCase());
  return candidato;
}

function chiaveParametro(x: unknown): string {
  return testoSicuro(x, 40).toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^_+|_+$/g, "");
}

export function normalizzaPianoLavoro(grezzo: unknown): { dati: PianoLavoroDati; avvisi: string[] } {
  const avvisi: string[] = [];
  const g: Json = isObj(grezzo) ? grezzo : {};

  const a: Json = isObj(g.appalto) ? g.appalto : {};
  const appalto: Appalto = {
    titolo: testoSicuro(a.titolo, 300) || "Servizio di pulizia",
    stazioneAppaltante: testoSicuro(a.stazioneAppaltante, 200),
    cig: testoSicuro(a.cig, 20) || null,
    riferimentoGara: testoSicuro(a.riferimentoGara, 80) || null,
    criterio: testoSicuro(a.criterio, 120) || null,
    importoBase: numero(a.importoBase),
  };

  // parametri: quelli standard sempre presenti (con i valori del modello se ci sono), poi alcuni extra
  const grezziParametri = arr(g.parametri).filter(isObj);
  const parametri: Parametro[] = DEFAULT_PARAMETRI.map((def) => {
    const dal = grezziParametri.find((p) => chiaveParametro(p.chiave) === def.chiave);
    if (!dal) return { ...def };
    const valore = numero(dal.valore);
    return {
      ...def,
      valore: valore ?? def.valore,
      origine: valore === null ? def.origine : origine(dal.origine, def.origine),
      fonte: testoSicuro(dal.fonte, 200) || def.fonte,
    };
  });
  const chiaviUsate = new Set(parametri.map((p) => p.chiave));
  for (const p of grezziParametri) {
    if (parametri.length >= DEFAULT_PARAMETRI.length + LIMITI.parametriExtra) break;
    const chiave = chiaveParametro(p.chiave);
    if (!chiave || chiaviUsate.has(chiave)) continue;
    chiaviUsate.add(chiave);
    const valore = numero(p.valore);
    parametri.push({
      chiave,
      etichetta: testoSicuro(p.etichetta, 120) || chiave,
      valore,
      unita: testoSicuro(p.unita, 20),
      origine: valore === null ? "mancante" : origine(p.origine, "documento"),
      fonte: testoSicuro(p.fonte, 200),
    });
  }
  const tolleranza = parametri.find((p) => p.chiave === PARAMETRI_STANDARD.tolleranza)!;
  if (tolleranza.valore !== null && tolleranza.valore > 1) tolleranza.valore = tolleranza.valore / 100;

  // tipologie
  const nomiTipologie = new Set<string>();
  const tipologie: Tipologia[] = [];
  for (const t of arr(g.tipologie).filter(isObj).slice(0, LIMITI.tipologie)) {
    const nome = univoco(nomeSicuro(t.nome), nomiTipologie);
    const lavorazioni: Lavorazione[] = arr(t.lavorazioni)
      .filter(isObj)
      .slice(0, LIMITI.lavorazioniPerTipologia)
      .map((l) => {
        const resa = numero(l.resa);
        const frequenza = quantita(l.frequenza, chiaviUsate);
        const resaValida = resa !== null && resa > 0 ? resa : null;
        return {
          nome: testoSicuro(l.nome, 120) || "Lavorazione",
          resa: resaValida,
          frequenza,
          notaFrequenza: testoSicuro(l.notaFrequenza, 120),
          origineResa: resaValida === null ? "mancante" : origine(l.origineResa, "ipotesi"),
          origineFrequenza: frequenza === null ? "mancante" : origine(l.origineFrequenza, "documento"),
          fonte: testoSicuro(l.fonte, 200),
          esclusaDaMq: l.esclusaDaMq === true,
          motivoEsclusione: l.esclusaDaMq !== true ? "" : l.motivoEsclusione === "parte_limitata" ? "parte_limitata" : "presidio",
        };
      });
    // una tipologia senza lavorazioni resterebbe con coefficiente 0 senza che nessuno se ne accorga: si segna come
    // dato mancante (celle gialle nel foglio delle rese)
    if (lavorazioni.length === 0) {
      lavorazioni.push({ nome: "Pulizia ordinaria", resa: null, frequenza: null, notaFrequenza: "", origineResa: "mancante", origineFrequenza: "mancante", fonte: "", esclusaDaMq: false, motivoEsclusione: "" });
    }
    tipologie.push({ id: `t${tipologie.length + 1}`, nome, unita: testoSicuro(t.unita, 12) || "mq", lavorazioni });
  }
  // servono sempre almeno una tipologia (le colonne delle metrature) e un livello (la ripartizione): se il modello
  // non ne ha trovate si parte da una voce generica da compilare, segnata come mancante o ipotesi
  if (tipologie.length === 0) {
    tipologie.push({
      id: "t1",
      nome: "Ambienti da pulire",
      unita: "mq",
      lavorazioni: [{ nome: "Pulizia ordinaria", resa: null, frequenza: null, notaFrequenza: "", origineResa: "mancante", origineFrequenza: "mancante", fonte: "", esclusaDaMq: false, motivoEsclusione: "" }],
    });
    nomiTipologie.add("ambienti da pulire");
    avvisi.push("Nessuna tipologia di ambiente trovata nei documenti: inserita una voce generica da compilare.");
  }
  // l'id con cui il modello indica una tipologia dentro le sedi può essere l'id o il nome
  const grezziTipologie = arr(g.tipologie).filter(isObj).slice(0, LIMITI.tipologie);
  const idPerRiferimento = (rif: string): string | null => {
    const diretto = tipologie.find((t) => t.id === rif);
    if (diretto) return diretto.id;
    const i = grezziTipologie.findIndex((t) => (typeof t.id === "string" && t.id === rif) || nomeSicuro(t.nome).toLowerCase() === nomeSicuro(rif).toLowerCase());
    return i >= 0 && tipologie[i] ? tipologie[i].id : null;
  };

  // sedi
  const nomiSedi = new Set<string>();
  const sedi: Sede[] = [];
  for (const s of arr(g.sedi).filter(isObj).slice(0, LIMITI.sedi)) {
    const mq: Record<string, number | null> = {};
    for (const t of tipologie) mq[t.id] = null;
    const grezzoMq = isObj(s.mq) ? s.mq : {};
    for (const [rif, v] of Object.entries(grezzoMq)) {
      const id = idPerRiferimento(rif);
      if (id) mq[id] = numero(v);
    }
    const aCanone = s.aCanone === false ? false : true;
    sedi.push({
      id: `s${sedi.length + 1}`,
      nome: univoco(testoSicuro(s.nome, 120), nomiSedi),
      indirizzo: testoSicuro(s.indirizzo, 160),
      mq,
      origineMq: origine(s.origineMq, Object.values(mq).some((v) => v !== null) ? "documento" : "mancante"),
      aCanone,
      canone: aCanone ? numero(s.canone) : null,
      oreDichiarate: numero(s.oreDichiarate),
      fonte: testoSicuro(s.fonte, 200),
    });
  }

  // presìdi
  const presidi: Presidio[] = arr(g.presidi)
    .filter(isObj)
    .slice(0, LIMITI.presidi)
    .map((p) => ({
      gruppo: testoSicuro(p.gruppo, 100) || "Presìdi e attività a forfait",
      descrizione: testoSicuro(p.descrizione, 200) || "Presidio",
      addetti: quantita(p.addetti, chiaviUsate),
      oreAddetto: quantita(p.oreAddetto, chiaviUsate),
      periodi: quantita(p.periodi, chiaviUsate),
      origine: origine(p.origine, "documento"),
      fonte: testoSicuro(p.fonte, 200),
    }));

  // ripartizione per livello: se le quote sembrano percentuali intere (85 invece di 0,85) si riportano a frazioni
  let organico: LivelloOrganico[] = arr(g.organico)
    .filter(isObj)
    .slice(0, LIMITI.livelli)
    .map((l) => ({
      livello: testoSicuro(l.livello, 30) || "Livello",
      ruolo: testoSicuro(l.ruolo, 200),
      quota: numero(l.quota),
      origine: origine(l.origine, "ipotesi"),
      fonte: testoSicuro(l.fonte, 200),
    }));
  if (organico.length === 0) {
    organico = [{ livello: "2°", ruolo: "Addetti alle pulizie (ripartizione non indicata nei documenti)", quota: 1, origine: "ipotesi", fonte: "Ipotesi: da validare con la clausola sociale o l'organizzazione prevista" }];
  }
  const sommaQuote = organico.reduce((s, l) => s + (l.quota ?? 0), 0);
  if (sommaQuote > 1.5) {
    organico = organico.map((l) => ({ ...l, quota: l.quota === null ? null : l.quota / 100 }));
    avvisi.push("Le quote per livello erano espresse in percentuale intera: riportate a frazioni.");
  }

  const personaleUscente: PersonaleUscente[] = arr(g.personaleUscente)
    .filter(isObj)
    .slice(0, LIMITI.personaleUscente)
    .map((p) => ({
      livello: testoSicuro(p.livello, 30) || "n.d.",
      unita: numero(p.unita) ?? 0,
      oreSettimanali: numero(p.oreSettimanali),
      nota: testoSicuro(p.nota, 160),
    }))
    .filter((p) => p.unita > 0);

  const macchinari: Macchinario[] = arr(g.macchinari)
    .filter(isObj)
    .slice(0, LIMITI.macchinari)
    .map((m) => {
      const vita = numero(m.vitaUtileMesi);
      const orig = m.origine === "catalogo" || m.origine === "ricerca_web" || m.origine === "ipotesi" ? m.origine : "ipotesi";
      return {
        categoria: testoSicuro(m.categoria, 40) || "Macchinari",
        descrizione: testoSicuro(m.descrizione, 200) || "Macchinario",
        riferimento: testoSicuro(m.riferimento, 120),
        quantita: numero(m.quantita),
        prezzoUnitario: numero(m.prezzoUnitario),
        vitaUtileMesi: vita !== null && vita > 0 ? vita : null,
        origine: orig,
        fontePrezzo: testoSicuro(m.fontePrezzo, 200),
        nota: testoSicuro(m.nota, 200),
      } satisfies Macchinario;
    });

  const dati: PianoLavoroDati = {
    versioneSchema: 1,
    appalto,
    parametri,
    tipologie,
    sedi,
    presidi,
    organico,
    personaleUscente,
    macchinari,
    budgetMacchinari: numero(g.budgetMacchinari),
    avvertenze: arr(g.avvertenze).map((x) => testoSicuro(x, 300)).filter(Boolean).slice(0, LIMITI.avvertenze),
    documenti: {
      letti: arr(isObj(g.documenti) ? g.documenti.letti : []).map((x) => testoSicuro(x, 160)).filter(Boolean).slice(0, LIMITI.documenti),
      nonLetti: arr(isObj(g.documenti) ? g.documenti.nonLetti : [])
        .filter(isObj)
        .map((x) => ({ nome: testoSicuro(x.nome, 160), motivo: testoSicuro(x.motivo, 160) }))
        .filter((x) => x.nome)
        .slice(0, LIMITI.documenti),
    },
  };
  // Il piano di un cliente non parla MAI di un'altra gara, nemmeno nelle note: il controllo gira qui, su tutti i testi, qualunque sia la strada dei dati.
  return { dati: proteggiPianoDaAltreGare(dati), avvisi };
}

// Toglie da tutti i testi del piano i riferimenti ad altre gare (vedi piano-lavoro-riservatezza.ts). Il nome di una gara da proteggere resta se è proprio
// quella di cui si fa il piano (compare nel titolo, nella stazione appaltante, nel riferimento, nelle sedi o nei nomi dei documenti). Idempotente.
export function proteggiPianoDaAltreGare(dati: PianoLavoroDati): PianoLavoroDati {
  const contesto = contestoDellaGara([dati.appalto.titolo, dati.appalto.stazioneAppaltante, dati.appalto.riferimentoGara, ...dati.sedi.map((s) => s.nome), ...dati.documenti.letti, ...dati.documenti.nonLetti.map((d) => d.nome)]);
  const esito = togliRiferimentiAdAltreGare(dati, contesto, ["documenti"]);
  if (esito.rimossi.length > 0) console.warn(`Piano di lavoro: tolti ${esito.rimossi.length} riferimenti ad altre gare dai testi`, esito.rimossi.slice(0, 5));
  return esito.valore;
}
