// SATER (Fase 2, documento 60): elenchi dei bandi del PORTALE Intercent-ER tramite l'API REST di Plone («++api++»). Logica pura: nessuna
// rete, nessun database. La rete è in intercenter.ts, la scrittura nel motore di unione unico (importa-regionali.ts).
//
// Perché questo canale (ricognizione R2 del 26/11, allegati/60/R2_sater_start.md):
//   - è PUBBLICATO dal portale stesso (Plone 6 / Volto espone l'API «++api++»), robots.txt non la vieta, e i dati del portale sono dichiarati
//     in licenza CC BY 4.0 «per qualsiasi fine, anche commerciale» (note legali di Intercent-ER): nessun indirizzo ricavato per analogia;
//   - 3 cartelle (bandi di altri enti, avvisi e indagini di altri enti, bandi di Intercent-ER), una richiesta ciascuna: ~250 avvisi in 3
//     richieste (il feed AF Soluzioni ne dà 20 per pagina e il suo indirizzo per SATER non è stato visto pubblicato);
//   - per ogni bando l'elenco dei CIG dei lotti, la scadenza con l'ora in UTC e il collegamento permanente «trovabando», che è lo stesso
//     collegamento (BT-15) riportato da PVL e TED: l'identificativo della procedura è esatto per costruzione.
//
// Mappa dei campi: quella OSSERVATA dalla ricognizione R2 (sola lettura, 26/11; nomi riportati dal coordinamento il 27/11), marcata «visto
// in R2». È l'uscita di un modello, quindi resta DICHIARATA e da confermare su un campione vero (passo autorizzato). Quelli di Plone
// («@id», «title», «description», «effective», «modified», «items», «items_total», «batching») sono dell'API documentata.
//
// DA CONFERMARE prima di qualunque lettura (CANALE_INTERCENTER.confermato = false finché non arrivano le conferme):
//   1. il canale: l'API del portale è davvero ammessa per questo uso, con i percorsi delle 3 cartelle e l'indirizzo dell'elenco visti in R2;
//   2. la licenza CC BY 4.0 copre i dati serviti dall'API;
//   3. i nomi dei campi su un campione vero, e due corrispondenze DEDOTTE da R2 (non viste): «id_intercenter» = numero del collegamento
//      «trovabando» (BANDO_GARA_PORTALE@<numero>, il BT-15 di PVL e TED) = IdMsg del feed AF Soluzioni.
// Se i campi attesi mancano in TUTTI gli elementi, il formato non è quello dichiarato: la fonte si sospende e non si scrive nulla.
//
// Nell'elenco NON ci sono CPV né importo (R2): la classificazione è sul testo (regole comuni) e il valore resta mancante. Il dettaglio
// (~60 KB per bando, con importo, CPV in codice interno e i dati personali dei referenti) NON si legge mai: qui si leggono SOLO i campi
// elencati in CAMPI_INTERCENTER, gli altri si scartano subito (elementoIntercenterDaGrezzo).
import { classificaGara, type SettoreRadar } from "../settori";
import { maiuscoleIniziali, type IdRegione } from "../territorio";
import { entraInOpportunita, opportunitaAflink, type Opportunita } from "../opportunita-calcoli";
import { idPiattaformaDaUrlConnettore } from "./piattaforme-calcoli";
import { cigSintel } from "./sintel-calcoli";
import { giornoDiRoma, impronta, type ScadenzaTed } from "./ted-calcoli";
import { proceduraDallOggettoAflink, tipoProceduraAflink } from "./aflink-calcoli";
import { settoriDopoNatura } from "./natura-contratto";
import type { LimitiFonte } from "./sessione-fonte";
import type { RecordLotto, RecordProcedura } from "./tipi";

export const PORTALE_INTERCENTER = "https://intercenter.regione.emilia-romagna.it";

export type CartellaIntercenter = {
  nome: "bandi_altri_enti" | "avvisi_altri_enti" | "bandi_intercenter";
  // il tipo dell'avviso, dalla cartella (bandi / avvisi e indagini): quello che nel feed AF Soluzioni è «Tipo»
  tipo: "Bando" | "Avviso";
  // percorso della cartella nel portale (dopo «/++api++/»), visto in R2; null = la cartella non si legge
  percorso: string | null;
};

export const CANALE_INTERCENTER = {
  // le tre conferme sopra (canale, licenza, nomi dei campi): finché è false il lettore si ferma prima di qualunque richiesta
  confermato: false as boolean,
  // le 3 cartelle degli avvisi APERTI viste in R2 (voci: 238, 6, 7). Le cartelle «chiusi», «in corso» e «consultazioni preliminari» no
  cartelle: [
    { nome: "bandi_altri_enti", tipo: "Bando", percorso: "bandi-e-strumenti-di-acquisto/bandi-altri-enti/altri-enti-bandi-e-procedure-di-gara/bandi-altri-enti-aperti" },
    { nome: "avvisi_altri_enti", tipo: "Avviso", percorso: "bandi-e-strumenti-di-acquisto/bandi-altri-enti/altri-enti-avvisi-e-indagini-di-mercato/avvisi-altri-enti-aperti" },
    { nome: "bandi_intercenter", tipo: "Bando", percorso: "bandi-e-strumenti-di-acquisto/bandi-intercenter/bandi-e-procedure-di-gara/bandi-aperti" },
  ] as readonly CartellaIntercenter[],
  // elementi per richiesta (b_size, come in R2): una pagina per cartella (la più grande ha 238 voci). Più voci: allarme, mai altre pagine
  elementiPerRichiesta: 500,
  regione: "emilia_romagna" as IdRegione,
  attribuzione: "Agenzia regionale Intercent-ER – SATER, Regione Emilia-Romagna (dati del portale, licenza CC BY 4.0)",
  licenza: "CC BY 4.0 dichiarata nelle note legali di Intercent-ER (da confermare per i dati serviti dall'API)",
};

// I campi letti di ogni elemento. «plone» = dell'API documentata di Plone; «visto_r2» = del contenuto «bando» del portale, con il nome visto
// nella ricognizione R2 (da confermare su un campione vero; uno solo per campo: nessun nome alternativo provato a caso).
export const CAMPI_INTERCENTER = {
  url: { nome: "@id", origine: "plone" },
  titolo: { nome: "title", origine: "plone" },
  descrizione: { nome: "description", origine: "plone" },
  pubblicazione: { nome: "effective", origine: "plone" },
  modifica: { nome: "modified", origine: "plone" },
  id: { nome: "id_intercenter", origine: "visto_r2" },
  ente: { nome: "ente_bando", origine: "visto_r2" },
  cig: { nome: "cig", origine: "visto_r2" },
  scadenza: { nome: "scadenza_bando", origine: "visto_r2" },
  tipologia: { nome: "tipologia_bando_intercenter", origine: "visto_r2" },
  stato: { nome: "bando_state", origine: "visto_r2" },
} as const;
export type CampoIntercenter = keyof typeof CAMPI_INTERCENTER;

// senza questi un elemento non si legge; se mancano in TUTTI il formato non è quello dichiarato e la fonte si sospende
export const CAMPI_INTERCENTER_OBBLIGATORI: readonly CampoIntercenter[] = ["url", "titolo", "scadenza", "id"];

// Collegamento permanente «trovabando» (BT-15) di una procedura SATER: la FORMA è quella vista in R2 (LINK_BT15_CALCOLATO del dettaglio,
// 302 verso la scheda); che il numero sia «id_intercenter» è DEDOTTO (da confermare sul campione vero).
export function collegamentoTrovabando(numero: string): string | null {
  return /^\d{1,12}$/.test(numero) ? `${PORTALE_INTERCENTER}/trovabando/BANDO_GARA_PORTALE@${numero}` : null;
}

// «id_intercenter»: «BANDO_GARA_PORTALE@<numero>» o il solo numero → il numero; altro → null (mai un identificativo indovinato).
export function numeroIntercenter(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : typeof v === "number" && Number.isInteger(v) ? String(v) : "";
  return s.match(/^(?:BANDO_GARA_PORTALE@)?(\d{1,12})$/)?.[1] ?? null;
}

export const LIMITI_INTERCENTER_PREDEFINITI: LimitiFonte = { pausaMs: 5_000, timeoutMs: 60_000, tentativi: 2, richiesteMassime: 4 };
export const LIMITI_INTERCENTER_INTERVALLI: Record<keyof LimitiFonte, { min: number; max: number }> = {
  pausaMs: { min: 2_000, max: 60_000 },
  timeoutMs: { min: 5_000, max: 120_000 },
  tentativi: { min: 1, max: 3 },
  richiesteMassime: { min: 3, max: 6 },
};

/** L'indirizzo dell'elenco di una cartella (API REST di Plone), o null se il percorso non è confermato. */
export function urlCartellaIntercenter(c: CartellaIntercenter): string | null {
  if (!c.percorso || !/^[a-z0-9][a-z0-9\-/]{0,200}$/.test(c.percorso) || c.percorso.includes("..")) return null;
  return `${PORTALE_INTERCENTER}/++api++/${c.percorso}?b_size=${CANALE_INTERCENTER.elementiPerRichiesta}&metadata_fields=_all`;
}

// ───── busta dell'API di Plone ─────

/** Un elemento ridotto ai SOLI campi dichiarati (tutto il resto, referenti compresi, è già scartato). */
export type ElementoIntercenter = Partial<Record<CampoIntercenter, unknown>>;

export type ElencoIntercenter = { elementi: ElementoIntercenter[]; totaleDichiarato: number | null };

export function elementoIntercenterDaGrezzo(x: Record<string, unknown>): ElementoIntercenter {
  const e: ElementoIntercenter = {};
  for (const [campo, d] of Object.entries(CAMPI_INTERCENTER) as [CampoIntercenter, { nome: string }][]) if (d.nome in x) e[campo] = x[d.nome];
  return e;
}

const presente = (v: unknown) => (Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined && String(v).trim() !== "");

// Il JSON di un elenco → elementi ridotti. Formato inatteso → errore (la fonte si sospende).
export function leggiElencoIntercenter(testo: string): ElencoIntercenter | { errore: string } {
  let j: unknown;
  try {
    j = JSON.parse(testo);
  } catch {
    return { errore: "la risposta non è JSON" };
  }
  if (!j || typeof j !== "object" || !Array.isArray((j as { items?: unknown }).items)) return { errore: "la risposta non è un elenco dell'API del portale" };
  const items = (j as { items: unknown[] }).items;
  const totale = Number((j as { items_total?: unknown }).items_total);
  const elementi = items.filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x)).map(elementoIntercenterDaGrezzo);
  if (elementi.length > 0 && elementi.every((e) => CAMPI_INTERCENTER_OBBLIGATORI.some((k) => !presente(e[k])))) return { errore: "agli elementi mancano i campi dichiarati (formato da confermare)" };
  if (elementi.length === 0 && Number.isFinite(totale) && totale > 0) return { errore: "l'elenco dichiara elementi ma non ne contiene" };
  return { elementi, totaleDichiarato: Number.isFinite(totale) ? totale : null };
}

// ───── campi ─────

const testo = (v: unknown, max = 4000): string => (typeof v === "string" ? v.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");

// Istante ISO con il fuso («2026-12-10T11:00:00+00:00», «…Z») → giorno di Roma e istante. Una mezzanotte di Roma esatta è un giorno senza ora
// (stessa regola di PVL e SardegnaCAT): l'ora non si presume mai. Senza fuso → null (un istante ambiguo non si interpreta).
export function scadenzaIntercenter(v: unknown): ScadenzaTed | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/.test(s)) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const giorno = giornoDiRoma(d);
  const ora = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(d);
  if (ora === "00:00:00") return { giorno, iso: null, oraIndicata: false, fonte: `${s} (UTC; mezzanotte: ora non indicata)` };
  return { giorno, iso: d.toISOString(), oraIndicata: true, fonte: `${s} (UTC)` };
}

// L'elenco dei CIG dei lotti: un elenco di testi, o un testo con separatori. Solo CIG validi, senza doppioni, nell'ordine dato.
export function cigIntercenter(v: unknown): string[] {
  const grezzi = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\s,;|]+/) : [];
  const out: string[] = [];
  for (const g of grezzi) {
    const c = cigSintel(typeof g === "string" ? g.trim() : g);
    if (c && !out.includes(c)) out.push(c);
  }
  return out.slice(0, 200);
}

// La pagina dell'elemento nel portale («@id»): https e SOLO sull'host del portale; senza «/++api++» (la pagina pubblica, non l'API).
export function paginaIntercenter(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (!/^https:\/\//i.test(s) || s.length > 2000) return null;
  try {
    const u = new URL(s);
    if (u.hostname.toLowerCase() !== new URL(PORTALE_INTERCENTER).hostname) return null;
    u.pathname = u.pathname.replace(/^\/\+\+api\+\+(?=\/|$)/, "") || "/";
    return u.toString();
  } catch {
    return null;
  }
}

// «Bando» o «Avviso» dichiarato dall'elemento (tipologia_bando_intercenter); altro o assente → null (vale allora la cartella).
export function tipologiaIntercenter(v: unknown): "Bando" | "Avviso" | null {
  const t = typeof v === "string" ? v.trim().toLowerCase() : "";
  return t === "bando" ? "Bando" : t === "avviso" ? "Avviso" : null;
}

// ───── un elemento → bando o esclusione ─────

export type MotivoEsclusioneIntercenter = "elemento_malformato" | "senza_identificativo" | "senza_oggetto" | "esclusa_per_oggetto" | "fuori_settore" | "riservata" | "affidamento" | "tipo_sconosciuto" | "scaduta";

export type MetaIntercenter = {
  cartella: CartellaIntercenter["nome"];
  // identificativo della procedura su SATER («id_intercenter» → numero del «trovabando»): «sater:<numero>»
  idPiattaforma: string;
  idProcedura: string;
  // versione: data di modifica dell'elemento nel portale (Plone «modified»), se c'è
  ultimaModifica: string | null;
  // stato dichiarato dal portale («bando_state»), così com'è: non si interpreta (i valori non sono noti), entra solo nell'impronta
  stato: string;
};

export type BandoIntercenter = {
  tipo: "bando";
  meta: MetaIntercenter;
  record: RecordProcedura;
  opportunita: Opportunita;
  settori: SettoreRadar[];
  metodoSettore: "cpv" | "parole_chiave";
  regioni: IdRegione[];
  scadenzaFonte: string | null;
  lottiScadenze: (ScadenzaTed | null)[];
  lottiDocumenti: (string | null)[];
  mancanti: string[];
};

export type EsclusioneIntercenter = { tipo: "esclusione"; meta: MetaIntercenter | null; motivo: MotivoEsclusioneIntercenter; regole?: string[] };

export type ElementoIntercenterLetto = BandoIntercenter | EsclusioneIntercenter;

export function leggiElementoIntercenter(cartella: CartellaIntercenter, e: ElementoIntercenter, adesso: Date): ElementoIntercenterLetto {
  const pagina = paginaIntercenter(e.url);
  if (!pagina) return { tipo: "esclusione", meta: null, motivo: "elemento_malformato" };
  // identità: SOLO da «id_intercenter» (numero del collegamento permanente «trovabando», il BT-15 di PVL e TED); senza, la gara non si scrive
  // (mai una chiave inventata). Il collegamento costruito deve tornare lo stesso identificativo con la regola dei connettori
  const numero = numeroIntercenter(e.id);
  const collegamento = numero ? collegamentoTrovabando(numero) : null;
  const idPiattaforma = idPiattaformaDaUrlConnettore(collegamento);
  if (!numero || !collegamento || idPiattaforma !== `sater:${numero}`) return { tipo: "esclusione", meta: null, motivo: "senza_identificativo" };
  const modifica = typeof e.modifica === "string" && !Number.isNaN(Date.parse(e.modifica)) ? new Date(e.modifica).toISOString() : null;
  const meta: MetaIntercenter = { cartella: cartella.nome, idPiattaforma, idProcedura: numero, ultimaModifica: modifica, stato: testo(e.stato, 40) };
  const esclusione = (motivo: MotivoEsclusioneIntercenter): EsclusioneIntercenter => ({ tipo: "esclusione", meta, motivo });

  const titolo = testo(e.titolo);
  const descrizione = testo(e.descrizione);
  if (!titolo) return esclusione("senza_oggetto");
  const testoGara = [titolo, descrizione].filter(Boolean).join(" ");

  // tipo dichiarato dall'elemento (tipologia_bando_intercenter), altrimenti quello della cartella; procedura SOLO se dichiarata nell'oggetto
  // (l'elenco non ha un campo procedura): come le istanze AF Soluzioni nuove
  const tipo = tipologiaIntercenter(e.tipologia) ?? cartella.tipo;
  const procedura = tipo === "Bando" ? proceduraDallOggettoAflink(testoGara) : null;
  const proceduraIgnota = tipo === "Bando" && !procedura;
  const opp = opportunitaAflink(tipo, procedura ?? (proceduraIgnota ? "Aperta" : ""), titolo);
  if (!opp) return esclusione("tipo_sconosciuto");
  if (opp.tipo === "affidamento_diretto") return esclusione("affidamento");
  if (!entraInOpportunita(opp)) return esclusione("riservata");

  const scadenza = scadenzaIntercenter(e.scadenza);
  const mancanti: string[] = ["luogo_esecuzione", "codice_fiscale_ente", "cpv"];
  if (proceduraIgnota && opp.tipo === "bando") mancanti.push("tipo_procedura");
  if (!scadenza) mancanti.push("scadenza");
  else if (scadenza.iso ? scadenza.iso < adesso.toISOString() : scadenza.giorno < giornoDiRoma(adesso)) return esclusione("scaduta");

  // l'elenco non dà il CPV: classificazione sul testo (stesse regole delle altre fonti)
  const classificazione = classificaGara({ cpvPrincipale: null, cpvTutti: [], testo: testoGara });
  if (classificazione.settori.length === 0) return classificazione.esclusioni.length > 0 ? { ...esclusione("esclusa_per_oggetto"), regole: [...new Set(classificazione.esclusioni.map((x) => x.regola))] } : esclusione("fuori_settore");
  const settoriTenuti = settoriDopoNatura(classificazione, null);
  if (settoriTenuti.length === 0) return esclusione("fuori_settore");

  // l'elenco non dà l'importo (R2): valore mancante, mai preso dal dettaglio (che contiene anche i dati personali dei referenti)
  mancanti.push("valore");
  const cig = cigIntercenter(e.cig);
  if (cig.length === 0) mancanti.push("cig");
  // un CIG = un lotto noto (numero d'ordine, senza oggetto: l'elenco non lo dà)
  const lotti: RecordLotto[] = cig.map((c, i) => ({ cig: c, numero: `LOT-${String(i + 1).padStart(4, "0")}`, oggetto: null, cpvPrincipale: null, cpvTutti: [], valoreStimato: null, valoreBase: null, oneriSicurezza: null, durataMesi: null, opzioniRinnovi: null }));

  const denominazione = testo(e.ente, 500) || null;
  const comune = denominazione?.match(/^comune di\s+(.+)$/i)?.[1] ?? null;
  const pubblicazione = typeof e.pubblicazione === "string" && !Number.isNaN(Date.parse(e.pubblicazione)) ? giornoDiRoma(new Date(e.pubblicazione)) : null;

  const record: RecordProcedura = {
    fonte: "regionale",
    idFonte: meta.idProcedura,
    chiaveProcedura: idPiattaforma,
    oggetto: titolo.slice(0, 4000),
    descrizione: descrizione || null,
    ente: { codiceFiscale: null, denominazione, comune: comune ? maiuscoleIniziali(comune) : null, provincia: null, regione: CANALE_INTERCENTER.regione, luogoIstat: null, nuts: null },
    tipoAvviso: tipo,
    tipoProcedura: tipoProceduraAflink(procedura),
    criterioAggiudicazione: null,
    natura: null,
    settoriSpeciali: null,
    dataPubblicazione: pubblicazione,
    scadenzaGiorno: scadenza?.giorno ?? null,
    scadenzaOfferte: scadenza?.iso ?? null,
    scadenzaOraIndicata: scadenza?.oraIndicata ?? false,
    valoreStimato: null,
    valoreBase: null,
    oneriSicurezza: null,
    durataMesi: null,
    annullata: false,
    // la pagina del bando nel portale (vista) e il collegamento permanente «trovabando» (BT-15, lo stesso di PVL e TED)
    urlAvviso: pagina,
    urlDocumenti: collegamento,
    cpvPrincipale: null,
    cpvTutti: [],
    lotti,
    impronta: "",
  };
  record.impronta = impronta({ ...record, impronta: null, settori: settoriTenuti, stato: meta.stato, opportunita: opp.tipo });

  return {
    tipo: "bando",
    meta,
    record,
    opportunita: opp,
    settori: settoriTenuti,
    metodoSettore: classificazione.metodo ?? "parole_chiave",
    regioni: [CANALE_INTERCENTER.regione],
    scadenzaFonte: scadenza?.fonte ?? null,
    lottiScadenze: lotti.map(() => scadenza),
    lottiDocumenti: lotti.map(() => collegamento),
    mancanti,
  };
}

export function leggiElementiIntercenter(cartella: CartellaIntercenter, elementi: readonly ElementoIntercenter[], adesso: Date): ElementoIntercenterLetto[] {
  return elementi.map((e) => leggiElementoIntercenter(cartella, e, adesso));
}
