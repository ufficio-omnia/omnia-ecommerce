// Rilevamento delle MODIFICHE di un bando tra due versioni PVL della stessa procedura (fase B4, email operative). Logica pura: nessuna rete,
// nessun database, nessun orologio, nessun modello AI. Provata da scripts/verifica-radar-b4-pvl.ts. B2 la collega all'importatore PVL.
//
// SOLO STAGING finché vale la D5: la PVL si legge solo dove è autorizzata e mai con richieste nuove per questo scopo; qui si confrontano
// avvisi già letti dal connettore.
//
// Che cosa dice la PVL (dati osservati: campione del 16/11, giri del 16-17/11, staging):
//   - stessa procedura = stesso «idAppalto»; ogni versione è un avviso nuovo («idAvviso»);
//   - la versione nuova di una rettifica ha «tipo» = "rettifica" (gli avvisi normali "avviso"): il connettore oggi non lo legge, qui sì;
//   - la versione vecchia, se riletta, ha «nuovoAvviso» (l'avviso che la sostituisce), «tipoNuovoAvviso» = "rettifica" e «attivo» = false;
//   - la scadenza: «termine_ricezione» per lotto e «dataScadenza» dell'avviso (regole di scadenzaPvl: mai un'ora presunta);
//   - i documenti: SOLO il collegamento alla piattaforma («documenti_di_gara_link»), mai l'elenco dei file: documenti nuovi o sostitutivi
//     NON si rilevano dalla PVL;
//   - i requisiti di partecipazione non ci sono (stanno nel disciplinare): NON si rilevano dalla PVL.
//
// Regole (decisione dell'utente del 19/11, §5: mai email per formattazione, riclassificazioni interne o inferenze):
//   - si confrontano valori NORMALIZZATI: istanti e non stringhe, testo senza maiuscole, spazi e punteggiatura, collegamenti senza «http» o
//     «https», barra finale e maiuscole dell'host, importi con tolleranza di mezzo centesimo. Una differenza solo di forma non è una modifica;
//   - settori, livelli, sottocategorie e versioni delle regole NON fanno parte della fotografia della versione: una riclassificazione non
//     può mai diventare una modifica;
//   - scadenza: un giorno diverso (proroga o anticipo) o un'ora diversa nello stesso giorno, con entrambe le ore indicate, è NOTIFICABILE;
//     un'ora che compare nello stesso giorno è notificabile solo dentro una rettifica dichiarata; un dato che sparisce non si notifica;
//   - gli altri cambiamenti (oggetto, importo, lotti, collegamento ai documenti, criterio) sono notificabili solo dentro una rettifica
//     DICHIARATA dalla fonte; senza dichiarazione si conservano come evidenza, non notificabili;
//   - una rettifica dichiarata senza cambiamenti nei dati letti è comunque una rettifica ufficiale: notificabile, senza inventare cosa è
//     cambiato («verificare l'avviso»);
//   - un annullamento dichiarato non è mai stato osservato sulla PVL: si registra, non si notifica finché non c'è un caso reale verificato.
// «Notificabile» qui = la fonte lo giustifica. L'importatore aggiunge le sue condizioni (giro incrementale, gara aperta, stessa notizia non
// già registrata da un'altra fonte nel motore di unione).
import { urlAvvisoPvl, type BandoPvl } from "./fonti/pvl-calcoli";
import { giornoDiRoma } from "./fonti/ted-calcoli";
import { testoPerConfronto } from "./settori";

export type ScadenzaFoto = { giorno: string | null; iso: string | null };

export type LottoFoto = { cig: string | null; valore: number | null; scadenza: ScadenzaFoto | null };

// La fotografia di una versione PVL: solo i dati che servono al confronto, nessun dato di persone, serializzabile (si può conservare come
// jsonb accanto alla provenienza dell'avviso, scelta di B2).
export type FotoVersionePvl = {
  versioneFoto: 1;
  idAvviso: string;
  idAppalto: string;
  scheda: string;
  // istante di pubblicazione (ISO)
  pubblicatoIl: string;
  // «tipo» dell'avviso secondo la PVL ("avviso", "rettifica"…), in minuscolo
  tipoDichiarato: string | null;
  // la versione che sostituisce questa, se la PVL lo dice (avviso riletto dopo la rettifica)
  sostituitoDa: string | null;
  tipoSostituzione: string | null;
  attivo: boolean;
  numeroTed: string | null;
  oggetto: string;
  scadenza: ScadenzaFoto;
  // il testo della fonte da cui viene la scadenza (per l'evidenza)
  scadenzaFonte: string | null;
  lotti: LottoFoto[];
  valore: number | null;
  documenti: string | null;
  criterio: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function testoBreve(x: unknown, max = 60): string | null {
  if (typeof x !== "string") return null;
  const t = x.replace(/\s+/g, " ").trim().toLowerCase();
  return t ? t.slice(0, max) : null;
}

// Solo il giorno e, se l'ora è indicata, l'istante: mai un'ora presunta.
function scadenzaFoto(giorno: string | null, iso: string | null, oraIndicata: boolean): ScadenzaFoto {
  return { giorno, iso: oraIndicata && iso ? iso : null };
}

// La fotografia di un bando già letto dal connettore (leggiAvvisoPvl), più il «tipo» dell'avviso grezzo, che il connettore non conserva.
export function fotoDaBandoPvl(b: BandoPvl, grezzo?: unknown): FotoVersionePvl {
  const g = grezzo && typeof grezzo === "object" && !Array.isArray(grezzo) ? (grezzo as Record<string, unknown>) : {};
  const r = b.record;
  return {
    versioneFoto: 1,
    idAvviso: b.meta.idAvviso,
    idAppalto: b.meta.idAppalto,
    scheda: b.meta.scheda,
    pubblicatoIl: b.meta.data,
    tipoDichiarato: testoBreve(g.tipo),
    sostituitoDa: b.meta.sostituitoDa,
    tipoSostituzione: testoBreve(b.meta.tipoSostituzione),
    attivo: b.meta.attivo,
    numeroTed: b.meta.numeroTed,
    oggetto: r.oggetto,
    scadenza: scadenzaFoto(r.scadenzaGiorno, r.scadenzaOfferte, r.scadenzaOraIndicata),
    scadenzaFonte: b.scadenzaFonte,
    lotti: r.lotti.map((l, i) => {
      const s = b.lottiScadenze[i] ?? null;
      return { cig: l.cig, valore: l.valoreStimato, scadenza: s ? scadenzaFoto(s.giorno, s.iso, s.oraIndicata) : null };
    }),
    valore: r.valoreStimato,
    documenti: r.urlDocumenti,
    criterio: r.criterioAggiudicazione,
  };
}

const GIORNO = /^\d{4}-\d{2}-\d{2}$/;

function scadenzaValida(x: unknown): ScadenzaFoto | null {
  if (!x || typeof x !== "object") return null;
  const s = x as Record<string, unknown>;
  const giorno = s.giorno === null ? null : typeof s.giorno === "string" && GIORNO.test(s.giorno) ? s.giorno : undefined;
  const iso = s.iso === null ? null : typeof s.iso === "string" && !Number.isNaN(Date.parse(s.iso)) ? s.iso : undefined;
  if (giorno === undefined || iso === undefined) return null;
  // un istante senza giorno, o con un giorno diverso da quello di Roma, non è una scadenza coerente
  if (iso && (!giorno || giornoDiRoma(new Date(iso)) !== giorno)) return null;
  return { giorno, iso };
}

function testoONullo(x: unknown, max: number): string | null | undefined {
  if (x === null) return null;
  return typeof x === "string" && x.length <= max ? x : undefined;
}

function numeroONullo(x: unknown): number | null | undefined {
  if (x === null) return null;
  return typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : undefined;
}

// Una fotografia riletta (per esempio dal database): la forma esatta, altrimenti null (mai confrontare dati che non si capiscono).
export function fotoPvlValida(x: unknown): FotoVersionePvl | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const f = x as Record<string, unknown>;
  if (f.versioneFoto !== 1) return null;
  if (typeof f.idAvviso !== "string" || !UUID.test(f.idAvviso) || typeof f.idAppalto !== "string" || !UUID.test(f.idAppalto)) return null;
  if (typeof f.scheda !== "string" || !/^[A-Z0-9_]{1,12}$/.test(f.scheda)) return null;
  if (typeof f.pubblicatoIl !== "string" || Number.isNaN(Date.parse(f.pubblicatoIl))) return null;
  if (typeof f.oggetto !== "string" || !f.oggetto || f.oggetto.length > 4000) return null;
  if (typeof f.attivo !== "boolean") return null;
  const testi = {
    tipoDichiarato: testoONullo(f.tipoDichiarato, 60),
    sostituitoDa: testoONullo(f.sostituitoDa, 36),
    tipoSostituzione: testoONullo(f.tipoSostituzione, 60),
    numeroTed: testoONullo(f.numeroTed, 20),
    scadenzaFonte: testoONullo(f.scadenzaFonte, 200),
    documenti: testoONullo(f.documenti, 2000),
    criterio: testoONullo(f.criterio, 100),
  };
  if (Object.values(testi).some((v) => v === undefined)) return null;
  if (testi.sostituitoDa && !UUID.test(testi.sostituitoDa)) return null;
  const scadenza = scadenzaValida(f.scadenza);
  const valore = numeroONullo(f.valore);
  if (!scadenza || valore === undefined || !Array.isArray(f.lotti) || f.lotti.length > 500) return null;
  const lotti: LottoFoto[] = [];
  for (const l of f.lotti) {
    if (!l || typeof l !== "object") return null;
    const x = l as Record<string, unknown>;
    const cig = x.cig === null ? null : typeof x.cig === "string" && /^[0-9A-Z]{10}$/.test(x.cig) ? x.cig : undefined;
    const v = numeroONullo(x.valore);
    const s = x.scadenza === null ? null : scadenzaValida(x.scadenza);
    if (cig === undefined || v === undefined || (x.scadenza !== null && !s)) return null;
    lotti.push({ cig, valore: v, scadenza: s });
  }
  return {
    versioneFoto: 1,
    idAvviso: f.idAvviso,
    idAppalto: f.idAppalto,
    scheda: f.scheda,
    pubblicatoIl: f.pubblicatoIl,
    tipoDichiarato: testi.tipoDichiarato as string | null,
    sostituitoDa: testi.sostituitoDa as string | null,
    tipoSostituzione: testi.tipoSostituzione as string | null,
    attivo: f.attivo,
    numeroTed: testi.numeroTed as string | null,
    oggetto: f.oggetto,
    scadenza,
    scadenzaFonte: testi.scadenzaFonte as string | null,
    lotti,
    valore,
    documenti: testi.documenti as string | null,
    criterio: testi.criterio as string | null,
  };
}

// ───── confronto ─────

export type Affidabilita = "affidabile" | "parziale";
// La categoria dell'email (decisione del 19/11, §1): E = proroga o modifica della scadenza, D = rettifica; l'annullamento resta a parte.
// La categoria «documenti» (F) non esiste per la PVL: la fonte non elenca i documenti.
export type CategoriaModifica = "scadenza" | "rettifica" | "annullamento";

export type ModificaPvl = {
  // il tipo di radar_aggiornamenti (vincolo della 0109): un anticipo della scadenza è una «rettifica» del campo scadenza
  tipo: "proroga" | "rettifica" | "annullamento";
  categoria: CategoriaModifica;
  campo: string | null;
  // il lotto (CIG) per i cambiamenti di un solo lotto
  lotto: string | null;
  prima: string | null;
  dopo: string | null;
  affidabilita: Affidabilita;
  notificabile: boolean;
  motivo: string;
};

export type EvidenzaPvl = {
  fonte: "pvl";
  idAppalto: string;
  idAvvisoPrecedente: string;
  idAvvisoNuovo: string;
  // pagina pubblica dell'avviso nuovo (pubblicazione con valore legale)
  urlAvviso: string;
  pubblicatoIl: string;
  giornoPubblicazione: string;
  // come la fonte dichiara la nuova versione: «tipo» dell'avviso nuovo, o «tipoNuovoAvviso» del vecchio che punta al nuovo
  dichiarazione: string | null;
  numeroTed: string | null;
  scadenzaFontePrecedente: string | null;
  scadenzaFonteNuova: string | null;
};

export type RilevamentoPvl =
  | { confrontabili: false; motivo: "foto_non_valida" | "appalti_diversi" | "stesso_avviso" | "versione_non_piu_recente" | "nessuna_versione_precedente"; rettificaDichiarata: boolean }
  | { confrontabili: true; rettificaDichiarata: boolean; modifiche: ModificaPvl[]; evidenza: EvidenzaPvl };

const MAX_VALORE = 2000;

function taglia(v: string | null): string | null {
  return v === null ? null : v.slice(0, MAX_VALORE);
}

// Ordine delle versioni: istante di pubblicazione, poi identificativo dell'avviso (come confrontaVersioniPvl del connettore).
function piuRecente(a: FotoVersionePvl, b: FotoVersionePvl): boolean {
  const ta = Date.parse(a.pubblicatoIl);
  const tb = Date.parse(b.pubblicatoIl);
  return ta !== tb ? ta > tb : a.idAvviso > b.idAvviso;
}

// Valore della scadenza come si conserva nel registro: l'istante normalizzato se l'ora è indicata, altrimenti il giorno.
export function valoreScadenzaFoto(s: ScadenzaFoto | null): string | null {
  if (!s || !s.giorno) return null;
  return s.iso ? new Date(s.iso).toISOString() : s.giorno;
}

function confrontaScadenza(prima: ScadenzaFoto | null, dopo: ScadenzaFoto | null, dichiarata: boolean, campo: string, lotto: string | null): ModificaPvl | null {
  const p = prima && prima.giorno ? prima : null;
  const d = dopo && dopo.giorno ? dopo : null;
  if (!p && !d) return null;
  const base = { campo, lotto, prima: valoreScadenzaFoto(p), dopo: valoreScadenzaFoto(d) };
  if (!d) return { ...base, tipo: "rettifica", categoria: "scadenza", affidabilita: "parziale", notificabile: false, motivo: "La nuova versione non indica la scadenza: un dato che sparisce non si notifica" };
  if (!p) return { ...base, tipo: "rettifica", categoria: "scadenza", affidabilita: "parziale", notificabile: false, motivo: "La versione precedente non indicava la scadenza: dato che compare, non una modifica verificabile" };
  const pg = p.giorno as string;
  const dg = d.giorno as string;
  if (pg !== dg) {
    const proroga = dg > pg;
    return { ...base, tipo: proroga ? "proroga" : "rettifica", categoria: "scadenza", affidabilita: "affidabile", notificabile: true, motivo: proroga ? "Giorno della scadenza posticipato" : "Giorno della scadenza anticipato" };
  }
  if (p.iso && d.iso) {
    const tp = Date.parse(p.iso);
    const td = Date.parse(d.iso);
    if (tp === td) return null;
    return { ...base, tipo: td > tp ? "proroga" : "rettifica", categoria: "scadenza", affidabilita: "affidabile", notificabile: true, motivo: td > tp ? "Ora della scadenza posticipata nello stesso giorno" : "Ora della scadenza anticipata nello stesso giorno" };
  }
  if (!p.iso && d.iso) {
    return { ...base, tipo: "rettifica", categoria: "scadenza", affidabilita: "parziale", notificabile: dichiarata, motivo: dichiarata ? "Ora della scadenza indicata dalla rettifica (prima era indicato solo il giorno)" : "Ora della scadenza comparsa senza una rettifica dichiarata: si conserva, non si notifica" };
  }
  if (p.iso && !d.iso) {
    return { ...base, tipo: "rettifica", categoria: "scadenza", affidabilita: "parziale", notificabile: false, motivo: "La nuova versione indica solo il giorno: l'ora non è più indicata, non si notifica" };
  }
  return null;
}

// Collegamento ai documenti senza le differenze di forma: protocollo, maiuscole dell'host, porta predefinita, barra finale, frammento.
export function collegamentoNormalizzato(u: string | null): string | null {
  if (!u) return null;
  try {
    const x = new URL(u.trim());
    const percorso = x.pathname.replace(/\/+$/, "");
    return `${x.hostname.toLowerCase()}${x.port && x.port !== "80" && x.port !== "443" ? `:${x.port}` : ""}${percorso}${x.search}`;
  } catch {
    return u.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  }
}

function stessoImporto(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) < 0.005;
}

function importo(v: number | null): string | null {
  return v === null ? null : v.toFixed(2);
}

function dichiarazione(prima: FotoVersionePvl, dopo: FotoVersionePvl): string | null {
  if (dopo.tipoDichiarato && dopo.tipoDichiarato !== "avviso") return dopo.tipoDichiarato;
  if (prima.sostituitoDa === dopo.idAvviso && prima.tipoSostituzione) return prima.tipoSostituzione;
  return null;
}

// Le modifiche tra la versione PVL precedente e quella nuova della stessa procedura, con l'evidenza. Mai un'eccezione: dati non confrontabili
// = { confrontabili: false } con il motivo.
export function rilevaModifichePvl(primaGrezza: FotoVersionePvl | null, dopoGrezza: FotoVersionePvl): RilevamentoPvl {
  const dopo = fotoPvlValida(dopoGrezza);
  if (!dopo) return { confrontabili: false, motivo: "foto_non_valida", rettificaDichiarata: false };
  const dichiarataSoloNuova = !!dopo.tipoDichiarato && /rettific/.test(dopo.tipoDichiarato);
  if (primaGrezza === null) return { confrontabili: false, motivo: "nessuna_versione_precedente", rettificaDichiarata: dichiarataSoloNuova };
  const prima = fotoPvlValida(primaGrezza);
  if (!prima) return { confrontabili: false, motivo: "foto_non_valida", rettificaDichiarata: dichiarataSoloNuova };
  if (prima.idAppalto !== dopo.idAppalto) return { confrontabili: false, motivo: "appalti_diversi", rettificaDichiarata: false };
  if (prima.idAvviso === dopo.idAvviso) return { confrontabili: false, motivo: "stesso_avviso", rettificaDichiarata: false };
  if (!piuRecente(dopo, prima)) return { confrontabili: false, motivo: "versione_non_piu_recente", rettificaDichiarata: false };

  const dich = dichiarazione(prima, dopo);
  const rettifica = !!dich && /rettific/.test(dich);
  const annullamento = !!dich && /annull|revoc/.test(dich);
  const modifiche: ModificaPvl[] = [];
  const altro = (campo: string, prima_: string | null, dopo_: string | null, affidabilita: Affidabilita, cosa: string, lotto: string | null = null) =>
    modifiche.push({
      tipo: "rettifica",
      categoria: "rettifica",
      campo,
      lotto,
      prima: taglia(prima_),
      dopo: taglia(dopo_),
      affidabilita,
      notificabile: rettifica,
      motivo: rettifica ? `${cosa}, nella rettifica dichiarata dalla fonte` : `${cosa} senza una rettifica dichiarata dalla fonte: si conserva come evidenza, non si notifica`,
    });

  if (annullamento) {
    modifiche.push({ tipo: "annullamento", categoria: "annullamento", campo: "stato", lotto: null, prima: "aperta", dopo: "annullata", affidabilita: "parziale", notificabile: false, motivo: `Annullamento dichiarato dalla fonte («${dich}»): mai osservato sulla PVL, si registra ma non si notifica finché non c'è un caso reale verificato` });
  }

  // scadenza della procedura (la più vicina tra i lotti)
  const scadenza = confrontaScadenza(prima.scadenza, dopo.scadenza, rettifica, "scadenza", null);
  if (scadenza) modifiche.push(scadenza);

  // lotti riconosciuti con certezza solo se TUTTI hanno il CIG in entrambe le versioni
  const conCig = prima.lotti.length > 0 && dopo.lotti.length > 0 && [...prima.lotti, ...dopo.lotti].every((l) => !!l.cig);
  if (conCig) {
    const cp = prima.lotti.map((l) => l.cig as string);
    const cd = dopo.lotti.map((l) => l.cig as string);
    if ([...cp].sort().join() !== [...cd].sort().join()) altro("lotti", [...cp].sort().join(", "), [...cd].sort().join(", "), "affidabile", "Lotti cambiati (CIG)");
    // scadenza di un solo lotto: solo se diversa dal cambiamento della procedura (altrimenti è già detta)
    if (dopo.lotti.length > 1 || prima.lotti.length > 1) {
      for (const ld of dopo.lotti) {
        const lp = prima.lotti.find((l) => l.cig === ld.cig);
        if (!lp) continue;
        const m = confrontaScadenza(lp.scadenza, ld.scadenza, rettifica, "scadenza_lotto", ld.cig);
        if (m && !(scadenza && scadenza.prima === m.prima && scadenza.dopo === m.dopo)) modifiche.push(m);
      }
    }
  } else if (prima.lotti.length !== dopo.lotti.length) {
    altro("n_lotti", String(prima.lotti.length), String(dopo.lotti.length), "parziale", "Numero di lotti cambiato (senza CIG su tutti i lotti)");
  }

  if (prima.valore !== null && dopo.valore !== null && !stessoImporto(prima.valore, dopo.valore)) altro("valore_stimato", importo(prima.valore), importo(dopo.valore), "affidabile", "Valore stimato cambiato");
  if (testoPerConfronto(prima.oggetto) !== testoPerConfronto(dopo.oggetto)) altro("oggetto", prima.oggetto, dopo.oggetto, "parziale", "Oggetto cambiato");
  const dp = collegamentoNormalizzato(prima.documenti);
  const dd = collegamentoNormalizzato(dopo.documenti);
  if (dp && dd && dp !== dd) altro("url_documenti", prima.documenti, dopo.documenti, "parziale", "Collegamento ai documenti di gara cambiato (la PVL non elenca i documenti: non dice se ce ne sono di nuovi o sostitutivi)");
  if (prima.criterio && dopo.criterio && prima.criterio !== dopo.criterio) altro("criterio_aggiudicazione", prima.criterio, dopo.criterio, "parziale", "Criterio di aggiudicazione cambiato");

  // una rettifica ufficiale senza cambiamenti nei dati letti: si notifica senza inventare che cosa è cambiato
  if (rettifica && !modifiche.some((m) => m.notificabile)) {
    modifiche.push({ tipo: "rettifica", categoria: "rettifica", campo: null, lotto: null, prima: null, dopo: null, affidabilita: "affidabile", notificabile: true, motivo: "Rettifica dichiarata dalla fonte; nessun cambiamento nei dati strutturati letti dalla PVL: verificare l'avviso ufficiale" });
  }

  return {
    confrontabili: true,
    rettificaDichiarata: rettifica,
    modifiche,
    evidenza: {
      fonte: "pvl",
      idAppalto: dopo.idAppalto,
      idAvvisoPrecedente: prima.idAvviso,
      idAvvisoNuovo: dopo.idAvviso,
      urlAvviso: urlAvvisoPvl(dopo.idAvviso),
      pubblicatoIl: new Date(dopo.pubblicatoIl).toISOString(),
      giornoPubblicazione: giornoDiRoma(new Date(dopo.pubblicatoIl)),
      dichiarazione: dich,
      numeroTed: dopo.numeroTed,
      scadenzaFontePrecedente: prima.scadenzaFonte,
      scadenzaFonteNuova: dopo.scadenzaFonte,
    },
  };
}
