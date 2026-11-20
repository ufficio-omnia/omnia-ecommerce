// Fase B4 (20/11/2026, B2) — dai FATTI delle gare agli EVENTI per impresa, e dagli eventi alle CONSEGNE per persona. Logica PURA: nessun
// database, nessuna rete, nessun orologio (oggi, gli istanti e gli identificativi arrivano come argomenti). La usa motore.ts.
//
// Regole (decisioni dell'utente del 19/11, documenti 26, 26B, 26_APPROVAZIONE_DEFINITIVA_B4, rapporto 38):
//   - una gara della lista dell'impresa (salvate ∪ monitorate; una gara aggiunta a mano e collegata all'archivio vale come la gara
//     dell'archivio) dà UN solo evento per (impresa, gara, tipo, versione);
//   - scadenze: promemoria a 10, 5 e 1 giorno per ogni scadenza distinta (calendario.ts), avviso «ravvicinato» una volta sola;
//   - modifiche: solo righe del registro con notifica_email (0123: verificate, notificabili), della fonte AUTORIZZATA per le notifiche
//     (fonteAutorizzata, ambiente.ts: PVL e fonti regionali solo sullo staging) e non nascosta ai clienti; Sintel solo per le scadenze
//     (decisione 11); mai «documenti» (nessuna fonte li rileva in modo attendibile); un avviso con più campi = UN evento;
//   - versione: scadenze = versioneScadenza; proroga e modifica della scadenza = «scadenza:» + la NUOVA scadenza (la stessa proroga da TED e
//     dalla PVL su una gara unita dà UN evento); rettifica e annullamento = l'avviso («ted:<numero>» anche quando la PVL cita il numero TED);
//   - riepilogo delle nuove opportunità: SOLO gare di classe A del profilo (decisione approvata; le B mai, nemmeno con le correlate accese),
//     al più MASSIMO_GARE_RIEPILOGO, le più recenti prima, più «altre N»; gare senza luogo solo se il profilo non ha regioni;
//   - le gare SALVATE o MONITORATE ricevono scadenze e rettifiche qualunque sia la loro classe.
// L'ora non si presume mai: l'istante c'è solo se la fonte (o l'impresa, per le gare aggiunte a mano) indica l'ora.

import { aperta as apertaArchivio, ETICHETTA_STATO, scadenzaDaValore, type StatoProcedura } from "../importa-calcoli";
import { fonteAutorizzata } from "../ambiente";
import { garaVisibileAiClienti, NOME_FONTE_ESTESO, type FonteGara } from "../fonti-gara-calcoli";
import { ETICHETTA_OPPORTUNITA, type TipoOpportunita } from "../opportunita-calcoli";
import { nomeRegione } from "../territorio";
import { eSettore } from "../settori-catalogo";
import { nomeSettore, type SettoreRadar } from "../settori";
import { garaPerRadarDaRiga, motivoPerTe } from "../profilo-calcoli";
import { opportunitaPerImpresa, type ProfiloRadar } from "../radar-personalizzato-contratto";
import type { ConClassificazioni } from "../classificazioni-lettura";
import { formattaScadenza } from "../email-modelli/formato";
import { giornoRoma, giorniDiCalendario, gruppiScadenza, oraRoma, promemoriaDovuti, versioniAttive, type LottoArchivio } from "./calendario";
import { PRIORITA_DEL_TIPO } from "./coda-calcoli";
import { destinatariCheRicevono, type PersonaImpresa, type PreferenzePersona, type StatoImpresaNotifiche } from "./destinatari-calcoli";
import { urlPerTe, urlScheda } from "./origine";
import { FINESTRA_NUOVE_GIORNI, type ParametriNotifiche } from "./parametri";
import {
  CATEGORIA_DEL_TIPO,
  MASSIMO_GARE_RIEPILOGO,
  versioneScadenza,
  type CategoriaNotifica,
  type EventoModifica,
  type EventoRadar,
  type EventoRiepilogo,
  type EventoScadenza,
  type EvidenzaModifica,
  type GaraEmail,
  type GaraRiepilogo,
  type GruppoScadenza,
  type LottoEmail,
  type ModificaRilevata,
  type ScadenzaNota,
  type TipoEvento,
} from "./tipi";

// ───────────────────────── righe lette dal motore (nomi del database) ─────────────────────────

/** Colonne di radar_procedure lette per le gare delle liste e per le nuove del riepilogo. */
export const COLONNE_GARA: string =
  "id, chiave, oggetto, sa_denominazione, luogo_regioni, tipo_opportunita, tipo_procedura, valore_stimato, data_pubblicazione, scadenza_giorno, scadenza_offerte, scadenza_ora_indicata, stato, unita_a, url_avviso, url_documenti, prima_rilevazione_il, ultima_rilevazione_il, fonti";
export type RigaGara = {
  id: string;
  chiave: string;
  oggetto: string;
  sa_denominazione: string | null;
  luogo_regioni: string[] | null;
  tipo_opportunita: string | null;
  tipo_procedura: string | null;
  valore_stimato: number | string | null;
  data_pubblicazione: string | null;
  scadenza_giorno: string | null;
  scadenza_offerte: string | null;
  scadenza_ora_indicata: boolean;
  stato: string;
  unita_a: string | null;
  url_avviso: string | null;
  url_documenti: string | null;
  prima_rilevazione_il: string;
  ultima_rilevazione_il: string;
  fonti: string[] | null;
};

export const COLONNE_LOTTO: string = "procedura_id, numero_lotto, oggetto, cig, scadenza_giorno, scadenza_offerte, scadenza_ora_indicata";
export type RigaLotto = {
  procedura_id: string;
  numero_lotto: string | null;
  oggetto: string | null;
  cig: string | null;
  scadenza_giorno: string | null;
  scadenza_offerte: string | null;
  scadenza_ora_indicata: boolean;
};

export const COLONNE_AGGIUNTA: string = "id, user_id, cig, url, oggetto, ente, scadenza_giorno, scadenza_offerte, scadenza_ora_indicata, procedura_id, creata_il, aggiornata_il";
export type RigaAggiunta = {
  id: string;
  user_id: string;
  cig: string | null;
  url: string | null;
  oggetto: string | null;
  ente: string | null;
  scadenza_giorno: string | null;
  scadenza_offerte: string | null;
  scadenza_ora_indicata: boolean;
  procedura_id: string | null;
  creata_il: string;
  aggiornata_il: string;
};

export const COLONNE_SALVATA: string = "user_id, procedura_id, aggiunta_id, creata_il";
export type RigaSalvata = { user_id: string; procedura_id: string | null; aggiunta_id: string | null; creata_il: string };

/** Colonne di radar_aggiornamenti (0109, 0112, 0123) lette dalla fase «eventi». */
export const COLONNE_MODIFICA: string =
  "id, procedura_id, tipo, campo, valore_precedente, valore_nuovo, fonte, id_fonte, rilevato_il, notificabile, notifica_email, avviso_url, avviso_pubblicato_il, avviso_ted, dichiarazione_fonte, affidabilita";
export type RigaModifica = {
  id: string;
  procedura_id: string;
  tipo: string;
  campo: string | null;
  valore_precedente: string | null;
  valore_nuovo: string | null;
  fonte: string;
  id_fonte: string | null;
  rilevato_il: string;
  notificabile: boolean;
  notifica_email: boolean;
  avviso_url: string | null;
  avviso_pubblicato_il: string | null;
  avviso_ted: string | null;
  dichiarazione_fonte: string | null;
  affidabilita: string | null;
};

// ───────────────────────── la gara come la vede l'email ─────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HTTP = /^https?:\/\/[^\s<>"'\u0000-\u001f]+$/i;

function link(u: string | null | undefined): string | null {
  const s = String(u ?? "").trim();
  return HTTP.test(s) ? s : null;
}

function lottoArchivio(l: RigaLotto): LottoArchivio {
  return {
    numero: l.numero_lotto,
    titolo: l.oggetto,
    cig: l.cig,
    scadenza: l.scadenza_giorno ? { giorno: l.scadenza_giorno, istante: l.scadenza_offerte, oraIndicata: l.scadenza_ora_indicata === true } : null,
  };
}

function fontiMostrabili(r: RigaGara, nascoste: ReadonlySet<string>): FonteGara[] {
  const prefisso = r.chiave.split(":")[0];
  const tutte = r.fonti && r.fonti.length ? r.fonti : [prefisso];
  return [...new Set(tutte)].filter((f): f is FonteGara => f in NOME_FONTE_ESTESO && !nascoste.has(f));
}

/** La gara dell'archivio per l'email (dati congelati nell'evento). */
export function garaEmailDaArchivio(r: RigaGara, lotti: readonly RigaLotto[], nascoste: ReadonlySet<string>, origine: string): GaraEmail {
  const chiave = `p:${r.id}`;
  const { gruppi, lottiSenzaScadenza } = gruppiScadenza(
    r.scadenza_giorno ? { giorno: r.scadenza_giorno, istante: r.scadenza_offerte, oraIndicata: r.scadenza_ora_indicata === true } : null,
    lotti.map(lottoArchivio),
    "fonte",
  );
  const regioni = (r.luogo_regioni ?? []).map((x) => nomeRegione(x)).filter((x): x is string => !!x);
  const tipo = r.tipo_opportunita && r.tipo_opportunita in ETICHETTA_OPPORTUNITA ? ETICHETTA_OPPORTUNITA[r.tipo_opportunita as TipoOpportunita] : null;
  return {
    chiave,
    proceduraId: r.id,
    aggiuntaId: null,
    denominazione: r.oggetto,
    stazioneAppaltante: r.sa_denominazione ?? null,
    cig: [...new Set(lotti.map((l) => l.cig).filter((c): c is string => !!c))].sort(),
    tipoAvviso: tipo,
    scadenze: gruppi,
    lottiSenzaScadenza,
    luogo: regioni.length ? regioni.join(", ") : null,
    urlScheda: urlScheda(origine, chiave) ?? `${origine}/`,
    urlFonteUfficiale: link(r.url_avviso) ?? link(r.url_documenti),
    fonti: fontiMostrabili(r, nascoste).map((f) => ({ fonte: f, nome: NOME_FONTE_ESTESO[f] })),
    ultimaVerificaIl: r.ultima_rilevazione_il,
    aggiuntaAMano: false,
  };
}

/** Una gara aggiunta a mano e NON collegata all'archivio: dati e scadenza inseriti dall'impresa, dichiarati come tali (D-E9). */
export function garaEmailDaAggiunta(a: RigaAggiunta, origine: string): GaraEmail {
  const chiave = `a:${a.id}`;
  const { gruppi } = gruppiScadenza(
    a.scadenza_giorno ? { giorno: a.scadenza_giorno, istante: a.scadenza_offerte, oraIndicata: a.scadenza_ora_indicata === true } : null,
    [],
    "impresa",
  );
  return {
    chiave,
    proceduraId: null,
    aggiuntaId: a.id,
    denominazione: a.oggetto ?? "Gara aggiunta a mano",
    stazioneAppaltante: a.ente ?? null,
    cig: a.cig ? [a.cig] : [],
    tipoAvviso: null,
    scadenze: gruppi,
    lottiSenzaScadenza: [],
    luogo: null,
    urlScheda: urlScheda(origine, chiave) ?? `${origine}/`,
    urlFonteUfficiale: link(a.url),
    fonti: [],
    ultimaVerificaIl: a.aggiornata_il,
    aggiuntaAMano: true,
  };
}

/** Una gara della lista di UN'impresa, pronta per il calcolo degli eventi. */
export type GaraInLista = {
  impresaId: string;
  chiave: string;
  /** l'istante in cui la gara è entrata nella lista (il primo, se è sia salvata sia aggiunta) */
  entrataInListaIl: string;
  /** stato «aperta» nell'archivio (le gare aggiunte a mano sono sempre aperte: decide la scadenza) */
  aperta: boolean;
  /** almeno una fonte visibile ai clienti (le gare aggiunte a mano sì) */
  visibile: boolean;
  /** fonti della gara (per le guardie del motore) */
  fonti: string[];
  gara: GaraEmail;
};

/**
 * Le liste delle imprese: salvate ∪ monitorate, una riga per (impresa, gara). Una gara collegata a un'altra (0117, unita_a) segue quella che
 * resta; una gara aggiunta a mano collegata all'archivio diventa la gara dell'archivio. Le righe senza la gara letta si saltano.
 */
export function gareDelleListe(x: {
  salvate: readonly RigaSalvata[];
  procedure: ReadonlyMap<string, RigaGara>;
  lotti: ReadonlyMap<string, readonly RigaLotto[]>;
  aggiunte: ReadonlyMap<string, RigaAggiunta>;
  nascoste: ReadonlySet<string>;
  origine: string;
}): GaraInLista[] {
  const perChiave = new Map<string, GaraInLista>();
  const daArchivio = (id: string | null): RigaGara | null => {
    let r = id ? (x.procedure.get(id) ?? null) : null;
    // una sola risalita: le unioni non creano catene (collegamenti.ts)
    if (r?.unita_a) r = x.procedure.get(r.unita_a) ?? null;
    return r;
  };
  for (const s of x.salvate) {
    if (!UUID.test(s.user_id)) continue;
    let voce: Omit<GaraInLista, "impresaId" | "entrataInListaIl"> | null = null;
    const a = s.aggiunta_id ? x.aggiunte.get(s.aggiunta_id) : undefined;
    const r = daArchivio(s.procedura_id ?? a?.procedura_id ?? null);
    if (r) {
      voce = {
        chiave: `p:${r.id}`,
        aperta: r.stato === "aperta",
        visibile: garaVisibileAiClienti({ fonti: r.fonti, chiave: r.chiave }, x.nascoste),
        fonti: r.fonti && r.fonti.length ? r.fonti : [r.chiave.split(":")[0]],
        gara: garaEmailDaArchivio(r, x.lotti.get(r.id) ?? [], x.nascoste, x.origine),
      };
    } else if (a && !a.procedura_id && a.user_id === s.user_id) {
      voce = { chiave: `a:${a.id}`, aperta: true, visibile: true, fonti: [], gara: garaEmailDaAggiunta(a, x.origine) };
    }
    if (!voce) continue;
    const k = `${s.user_id}|${voce.chiave}`;
    const prima = perChiave.get(k);
    if (!prima || Date.parse(s.creata_il) < Date.parse(prima.entrataInListaIl)) perChiave.set(k, { impresaId: s.user_id, entrataInListaIl: s.creata_il, ...voce });
  }
  return [...perChiave.values()];
}

// ───────────────────────── eventi ─────────────────────────

/** Un evento da inserire in omnia_ai_radar_eventi (riga del database più i dati congelati del contratto). */
export type EventoNuovo = {
  id: string;
  impresaId: string;
  categoria: CategoriaNotifica;
  tipo: TipoEvento;
  garaChiave: string;
  proceduraId: string | null;
  aggiuntaId: string | null;
  aggiornamentoId: string | null;
  versione: string;
  priorita: number;
  dati: EventoRadar;
};

/** La chiave unica dell'evento nel database (omnia_ai_radar_eventi_unico). */
export function chiaveEvento(e: Pick<EventoNuovo, "impresaId" | "garaChiave" | "tipo" | "versione">): string {
  return `${e.impresaId}|${e.garaChiave}|${e.tipo}|${e.versione}`;
}

type Contesto = { nuovoId: () => string; adessoIso: string };

function eventoScadenza(g: GaraInLista, tipo: EventoScadenza["tipo"], gruppo: GruppoScadenza, giorniMancanti: number, c: Contesto): EventoNuovo {
  const id = c.nuovoId();
  const versione = versioneScadenza(gruppo.scadenza);
  const dati: EventoScadenza = {
    id,
    impresaId: g.impresaId,
    nomeImpresa: null,
    categoria: "scadenze",
    tipo,
    versione,
    creatoIl: c.adessoIso,
    gara: g.gara,
    gruppo,
    giorniMancanti,
  };
  return {
    id,
    impresaId: g.impresaId,
    categoria: "scadenze",
    tipo,
    garaChiave: g.chiave,
    proceduraId: g.gara.proceduraId,
    aggiuntaId: g.gara.aggiuntaId,
    aggiornamentoId: null,
    versione,
    priorita: PRIORITA_DEL_TIPO[tipo],
    dati,
  };
}

/** I promemoria a 10, 5 e 1 giorno che nascono OGGI (con il recupero breve dei giri saltati: calendario.ts). */
export function eventiScadenza(x: { oggi: string; liste: readonly GaraInLista[]; ultimoGiroRiuscito: string | null } & Contesto): EventoNuovo[] {
  const esito: EventoNuovo[] = [];
  for (const g of x.liste) {
    if (!g.visibile) continue;
    for (const p of promemoriaDovuti({ oggi: x.oggi, gruppi: g.gara.scadenze, entrataInListaIl: g.entrataInListaIl, ultimoGiroRiuscito: x.ultimoGiroRiuscito, aperta: g.aperta })) {
      esito.push(eventoScadenza(g, p.tipo, p.gruppo, p.giorniMancanti, x));
    }
  }
  return esito;
}

/** Giorni di calendario a Roma entro cui una gara appena entrata nella lista riceve l'avviso «ravvicinato» (D-E2). */
export const GIORNI_RAVVICINATA = 2;

/**
 * L'avviso «scadenza ravvicinata» per UNA gara appena entrata nella lista: una volta per versione della scadenza, solo se mancano 0–2 giorni
 * (oggi solo se l'ora indicata non è passata), mai se il promemoria a 1 giorno di quella versione è già nato.
 */
export function eventiRavvicinati(x: { oggi: string; adesso: Date; gara: GaraInLista; versioniScadenza1: ReadonlySet<string> } & Contesto): EventoNuovo[] {
  const g = x.gara;
  if (!g.visibile || !g.aperta) return [];
  const esito: EventoNuovo[] = [];
  for (const gruppo of g.gara.scadenze) {
    const mancanti = giorniDiCalendario(x.oggi, gruppo.scadenza.giorno);
    if (mancanti < 0 || mancanti > GIORNI_RAVVICINATA) continue;
    if (mancanti === 0 && gruppo.scadenza.istante && Date.parse(gruppo.scadenza.istante) <= x.adesso.getTime()) continue;
    if (x.versioniScadenza1.has(versioneScadenza(gruppo.scadenza))) continue;
    esito.push(eventoScadenza(g, "scadenza_ravvicinata", gruppo, mancanti, x));
  }
  return esito;
}

// ───── modifiche ─────

const ETICHETTA_CAMPO: Record<string, { campo: ModificaRilevata["campo"]; etichetta: string }> = {
  scadenza_offerte: { campo: "scadenza", etichetta: "Scadenza per la presentazione delle offerte" },
  valore_stimato: { campo: "importo", etichetta: "Importo stimato" },
  oggetto: { campo: "oggetto", etichetta: "Oggetto della gara" },
  n_lotti: { campo: "lotti", etichetta: "Numero dei lotti" },
  stato: { campo: "stato", etichetta: "Stato della gara" },
};

/**
 * Motivo DICHIARATO dalla fonte, in parole (codici dell'elenco «change-corrig-justification» di eForms per TED; «rettifica» per la PVL).
 * Un codice non in elenco non si traduce né si suppone: null (l'email rimanda all'avviso ufficiale).
 */
export const MOTIVO_FONTE: Readonly<Record<string, string>> = {
  "cor-buy": "Correzione da parte dell'amministrazione aggiudicatrice",
  "cor-pub": "Correzione da parte dell'Ufficio delle pubblicazioni dell'Unione europea",
  "update-add": "Aggiornamento con informazioni aggiuntive",
  cancel: "Annullamento della procedura",
  "susp-review": "Procedura sospesa per un ricorso",
  "info-release": "Informazioni rese disponibili",
  rettifica: "Avviso di rettifica",
};

const FORMATO_IMPORTO = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });

const CIG = /^[0-9A-Z]{10}$/;
/** Il lotto dopo «@» nel campo del registro: il CIG, oppure il numero del lotto della fonte («LOT-0002» di TED, «SINTEL-123» di Sintel). */
const LOTTO_DEL_CAMPO = /^[0-9A-Za-z][0-9A-Za-z._-]{0,39}$/;

function campoBase(campo: string | null): { base: string; lotto: string | null } {
  const [base, lotto] = String(campo ?? "").split("@");
  return { base, lotto: lotto && LOTTO_DEL_CAMPO.test(lotto) ? lotto : null };
}

/** Una scadenza scritta nel registro (istante se c'era l'ora, altrimenti il giorno) come scadenza nota del contratto. */
export function scadenzaDaRegistro(v: string | null): ScadenzaNota | null {
  const s = scadenzaDaValore(v);
  if (!s.giorno) return null;
  if (!s.iso) return { giorno: s.giorno, ora: null, istante: null, origine: "fonte" };
  const t = Date.parse(s.iso);
  if (!Number.isFinite(t)) return { giorno: s.giorno, ora: null, istante: null, origine: "fonte" };
  const istante = new Date(t).toISOString();
  return { giorno: giornoRoma(istante), ora: oraRoma(istante), istante, origine: "fonte" };
}

function leggibile(base: string, v: string | null): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (base === "scadenza_offerte") return formattaScadenza(scadenzaDaRegistro(v));
  if (base === "valore_stimato") {
    const n = Number(v);
    return Number.isFinite(n) ? FORMATO_IMPORTO.format(n) : null;
  }
  if (base === "stato") return ETICHETTA_STATO[v as StatoProcedura] ?? null;
  return v.slice(0, 2000);
}

/**
 * Il lotto della riga, cercato nei lotti dell'archivio per CIG e poi per numero (difetto «proroga di un solo lotto», 20/11: TED e Sintel
 * non hanno sempre il CIG). Non trovato: solo ciò che dice il campo, mai inventato.
 */
function lottiDelCampo(lotto: string | null, g: GaraEmail): LottoEmail[] {
  if (!lotto) return [];
  const tutti = [...g.scadenze.flatMap((s) => s.lotti), ...g.lottiSenzaScadenza];
  const trovato = tutti.find((l) => l.cig === lotto) ?? tutti.find((l) => l.numero === lotto);
  if (trovato) return [trovato];
  return [CIG.test(lotto) ? { numero: null, titolo: null, cig: lotto } : { numero: lotto, titolo: null, cig: null }];
}

/** Lo stesso lotto una volta sola (TED con il numero e la PVL con il CIG possono dire la stessa proroga dello stesso lotto). */
function lottiDistinti(lotti: readonly LottoEmail[]): LottoEmail[] {
  const visti = new Set<string>();
  return lotti.filter((l) => {
    const k = `${l.cig ?? ""}|${l.numero ?? ""}`;
    if (visti.has(k)) return false;
    visti.add(k);
    return true;
  });
}

function modificaRilevata(r: RigaModifica, g: GaraEmail): ModificaRilevata | null {
  const { base, lotto } = campoBase(r.campo);
  const e = ETICHETTA_CAMPO[base];
  if (!e) return null;
  return { campo: e.campo, etichetta: e.etichetta, prima: leggibile(base, r.valore_precedente), dopo: leggibile(base, r.valore_nuovo), lotti: lottiDelCampo(lotto, g) };
}

/** L'avviso che porta la modifica: «ted:<numero>» (anche quando la PVL cita il numero TED), «<fonte>:<id>», oppure la riga stessa. */
export function chiaveAvviso(r: Pick<RigaModifica, "id" | "fonte" | "id_fonte" | "avviso_ted">): string {
  if (r.avviso_ted) return `ted:${r.avviso_ted}`;
  if (r.id_fonte) return r.fonte === "ted" ? `ted:${r.id_fonte}` : `${r.fonte}:${r.id_fonte}`;
  return `agg:${r.id}`;
}

export type MotivoModificaSaltata = "non_notificabile" | "fonte_non_autorizzata" | "fonte_nascosta" | "sintel_non_scadenza" | "documenti" | "affidabilita" | "gara_non_in_lista";

/**
 * Gli eventi delle modifiche per le gare delle liste. Una riga che non passa le regole si conta in `saltate` col motivo, mai in silenzio.
 * `env` serve SOLO a fonteAutorizzata (uso «notifiche»).
 */
export function eventiModifica(
  x: { modifiche: readonly RigaModifica[]; liste: readonly GaraInLista[]; nascoste: ReadonlySet<string>; env: Record<string, string | undefined> } & Contesto,
): { eventi: EventoNuovo[]; saltate: Partial<Record<MotivoModificaSaltata, number>> } {
  const saltate: Partial<Record<MotivoModificaSaltata, number>> = {};
  const salta = (m: MotivoModificaSaltata) => (saltate[m] = (saltate[m] ?? 0) + 1);
  // righe valide per gara, poi per avviso
  const perGara = new Map<string, Map<string, RigaModifica[]>>();
  for (const r of x.modifiche) {
    const { base } = campoBase(r.campo);
    if (!r.notifica_email || !r.notificabile || !["rettifica", "proroga", "annullamento"].includes(r.tipo)) { salta("non_notificabile"); continue; }
    if (r.affidabilita !== "avviso_ufficiale" && r.affidabilita !== "confronto_versioni") { salta("affidabilita"); continue; }
    if (!fonteAutorizzata(r.fonte, "notifiche", x.env).ok) { salta("fonte_non_autorizzata"); continue; }
    if (x.nascoste.has(r.fonte)) { salta("fonte_nascosta"); continue; }
    if (base === "url_documenti") { salta("documenti"); continue; }
    if (r.fonte === "sintel" && base !== "scadenza_offerte") { salta("sintel_non_scadenza"); continue; }
    const avvisi = perGara.get(r.procedura_id) ?? new Map<string, RigaModifica[]>();
    const k = chiaveAvviso(r);
    avvisi.set(k, [...(avvisi.get(k) ?? []), r]);
    perGara.set(r.procedura_id, avvisi);
  }
  const liste = new Map<string, GaraInLista[]>();
  for (const g of x.liste) if (g.gara.proceduraId && g.visibile) liste.set(g.gara.proceduraId, [...(liste.get(g.gara.proceduraId) ?? []), g]);

  const eventi: EventoNuovo[] = [];
  const visti = new Set<string>();
  for (const [proceduraId, avvisi] of perGara) {
    const imprese = liste.get(proceduraId);
    if (!imprese) { for (const r of avvisi.values()) for (let i = 0; i < r.length; i++) salta("gara_non_in_lista"); continue; }
    // la stessa notizia da due fonti (TED e PVL su una gara unita) dà UN evento: prima gli avvisi ufficiali, poi TED, poi l'ordine delle chiavi,
    // così l'evidenza dell'email è quella più forte e il risultato non dipende dall'ordine di lettura
    const peso = (righe: RigaModifica[]) => (righe.some((r) => r.affidabilita === "avviso_ufficiale") ? 0 : 2) + (righe.some((r) => r.fonte === "ted") ? 0 : 1);
    for (const [avviso, righe] of [...avvisi.entries()].sort(([a, ra], [b, rb]) => peso(ra) - peso(rb) || a.localeCompare(b))) {
      righe.sort((a, b) => a.rilevato_il.localeCompare(b.rilevato_il) || a.id.localeCompare(b.id));
      const ufficiale = righe.find((r) => r.affidabilita === "avviso_ufficiale") ?? righe[0];
      for (const g of imprese) {
        const evidenza: EvidenzaModifica = {
          fonte: ufficiale.fonte,
          nomeFonte: NOME_FONTE_ESTESO[ufficiale.fonte as FonteGara] ?? ufficiale.fonte,
          avvisoId: ufficiale.id_fonte,
          avvisoUrl: link(ufficiale.avviso_url),
          pubblicatoIl: ufficiale.avviso_pubblicato_il,
          rilevatoIl: ufficiale.rilevato_il,
          affidabilita: ufficiale.affidabilita as EvidenzaModifica["affidabilita"],
          motivoFonte: ufficiale.dichiarazione_fonte ? (MOTIVO_FONTE[ufficiale.dichiarazione_fonte] ?? null) : null,
        };
        const tutte = righe.map((r) => modificaRilevata(r, g.gara)).filter((m): m is ModificaRilevata => m !== null);
        const nuovo = (tipo: EventoModifica["tipo"], versione: string, modifiche: ModificaRilevata[], cambio: EventoModifica["cambioScadenza"], agg: string): void => {
          const k = chiaveEvento({ impresaId: g.impresaId, garaChiave: g.chiave, tipo, versione });
          if (visti.has(k)) return; // stessa notizia da un altro avviso nello stesso giro (es. TED e PVL): un solo evento
          visti.add(k);
          const id = x.nuovoId();
          const dati: EventoModifica = { id, impresaId: g.impresaId, nomeImpresa: null, categoria: "rettifiche", tipo, versione, creatoIl: x.adessoIso, gara: g.gara, modifiche, evidenza, cambioScadenza: cambio };
          eventi.push({ id, impresaId: g.impresaId, categoria: "rettifiche", tipo, garaChiave: g.chiave, proceduraId: g.gara.proceduraId, aggiuntaId: null, aggiornamentoId: agg, versione, priorita: PRIORITA_DEL_TIPO[tipo], dati });
        };
        if (righe.some((r) => r.tipo === "annullamento")) {
          // l'annullamento assorbe gli altri cambiamenti dello stesso avviso; il modello non elenca supposizioni
          nuovo("annullamento", avviso, tutte.filter((m) => m.campo !== "stato"), null, righe.find((r) => r.tipo === "annullamento")!.id);
          continue;
        }
        const diScadenza = righe.filter((r) => campoBase(r.campo).base === "scadenza_offerte");
        if (diScadenza.length) {
          // una serie per ogni NUOVA scadenza distinta (lotti con la stessa nuova scadenza insieme); gli altri campi dell'avviso vanno con la prima
          const perNuova = new Map<string, RigaModifica[]>();
          // con righe per LOTTO nello stesso avviso, la riga della GARA (per TED e Sintel la scadenza più vicina tra i lotti) non apre una
          // serie sua se la sua nuova scadenza non è quella di nessun lotto cambiato: è solo l'effetto dello spostamento di un lotto (un lotto
          // prorogato oltre un altro), mai una proroga da annunciare (difetto «proroga di un solo lotto», 20/11)
          const nuoveDeiLotti = new Set(
            diScadenza.filter((r) => campoBase(r.campo).lotto).flatMap((r) => {
              const n = scadenzaDaRegistro(r.valore_nuovo);
              return n ? [versioneScadenza(n)] : [];
            }),
          );
          for (const r of diScadenza) {
            const n = scadenzaDaRegistro(r.valore_nuovo);
            if (!n) continue;
            const v = versioneScadenza(n);
            if (nuoveDeiLotti.size > 0 && !campoBase(r.campo).lotto && !nuoveDeiLotti.has(v)) continue;
            perNuova.set(v, [...(perNuova.get(v) ?? []), r]);
          }
          const altri = tutte.filter((m) => m.campo !== "scadenza");
          let primo = true;
          for (const [v, rr] of [...perNuova.entries()].sort(([a], [b]) => a.localeCompare(b))) {
            const nuova = scadenzaDaRegistro(rr[0].valore_nuovo)!;
            const precedente = scadenzaDaRegistro(rr[0].valore_precedente);
            const lotti = lottiDistinti(rr.flatMap((r) => lottiDelCampo(campoBase(r.campo).lotto, g.gara)));
            const tipo = rr.every((r) => r.tipo === "proroga") ? "proroga" : "modifica_scadenza";
            const proprie = rr.map((r) => modificaRilevata(r, g.gara)).filter((m): m is ModificaRilevata => m !== null);
            nuovo(tipo, `scadenza:${v}`, [...proprie, ...(primo ? altri : [])], { precedente, nuova, lotti }, rr[0].id);
            primo = false;
          }
          continue;
        }
        // rettifica: i campi confrontati (vuoto se l'avviso ufficiale non cambia nulla di ciò che confrontiamo: «leggere l'avviso»)
        nuovo("rettifica", avviso, tutte, null, righe[0].id);
      }
    }
  }
  return { eventi, saltate };
}

// ───── annullamenti dei promemoria ─────

export type EventoAttivo = { id: string; impresaId: string; garaChiave: string; tipo: TipoEvento; versione: string };
export type Annullamento = { id: string; motivo: "scadenza_cambiata" | "gara_non_aperta" | "fuori_lista" };

/**
 * I promemoria ancora attivi che non valgono più: la gara non è più nella lista, non è più aperta, oppure la loro versione non è più la
 * scadenza di NESSUN gruppo della gara (proroga; un lotto che ha ancora la vecchia scadenza la tiene viva: calendario.versioniDaAnnullare).
 */
export function annullamentiScadenze(liste: readonly GaraInLista[], attivi: readonly EventoAttivo[]): Annullamento[] {
  const perChiave = new Map(liste.map((g) => [`${g.impresaId}|${g.chiave}`, g]));
  const esito: Annullamento[] = [];
  for (const e of attivi) {
    if (CATEGORIA_DEL_TIPO[e.tipo] !== "scadenze") continue;
    const g = perChiave.get(`${e.impresaId}|${e.garaChiave}`);
    if (!g) esito.push({ id: e.id, motivo: "fuori_lista" });
    else if (!g.aperta) esito.push({ id: e.id, motivo: "gara_non_aperta" });
    else if (!versioniAttive(g.gara.scadenze).has(e.versione)) esito.push({ id: e.id, motivo: "scadenza_cambiata" });
  }
  return esito;
}

// ───── riepilogo delle nuove opportunità ─────

/** Una gara candidata al riepilogo: la riga dell'archivio con le classificazioni incorporate (0121). */
export type RigaNuova = RigaGara & ConClassificazioni;

/** La gara è «nuova» per il giro: entrata nell'archivio dopo il cursore e pubblicata da non più di FINESTRA_NUOVE_GIORNI giorni. */
export function nuovaPerIlGiro(r: Pick<RigaGara, "prima_rilevazione_il" | "data_pubblicazione">, cursore: string | null, oggi: string): boolean {
  if (cursore && !(Date.parse(r.prima_rilevazione_il) > Date.parse(cursore))) return false;
  if (!r.data_pubblicazione) return false;
  const giorni = giorniDiCalendario(r.data_pubblicazione, oggi);
  return giorni >= 0 && giorni <= FINESTRA_NUOVE_GIORNI;
}

/**
 * Il riepilogo di OGGI per un'impresa: le gare nuove PERTINENTI (classe A) per il suo profilo, le più recenti prima, al più
 * MASSIMO_GARE_RIEPILOGO più «altre N». Mai le correlate (B), mai le C, mai le gare collegate, chiuse o non visibili ai clienti; le gare la
 * cui unica fonte non è autorizzata per le notifiche in questo ambiente (PVL fuori dallo staging) non entrano. N5: con il parametro, niente
 * gare già nella lista dell'impresa. Nessuna gara: nessun evento.
 */
export function eventoRiepilogo(
  x: {
    oggi: string;
    adesso: Date;
    impresaId: string;
    profilo: ProfiloRadar | null;
    nuove: readonly RigaNuova[];
    giaInLista: ReadonlySet<string>;
    parametri: Pick<ParametriNotifiche, "escludiGiaSalvateDalRiepilogo">;
    nascoste: ReadonlySet<string>;
    env: Record<string, string | undefined>;
    origine: string;
  } & Contesto,
): EventoNuovo | null {
  const p = x.profilo;
  if (!p || p.settori.length === 0) return null;
  const candidate = x.nuove.filter((r) => {
    if (r.stato !== "aperta" || r.unita_a) return false;
    if (!apertaArchivio("aperta", { giorno: r.scadenza_giorno, iso: r.scadenza_ora_indicata ? r.scadenza_offerte : null }, x.adesso)) return false;
    if (!garaVisibileAiClienti({ fonti: r.fonti, chiave: r.chiave }, x.nascoste)) return false;
    const fonti = (r.fonti && r.fonti.length ? r.fonti : [r.chiave.split(":")[0]]).filter((f) => !x.nascoste.has(f));
    if (!fonti.some((f) => fonteAutorizzata(f, "notifiche", x.env).ok)) return false;
    if (x.parametri.escludiGiaSalvateDalRiepilogo && x.giaInLista.has(r.id)) return false;
    return true;
  });
  const perId = new Map(candidate.map((r) => [r.id, r]));
  const opportunita = opportunitaPerImpresa(candidate.map((r) => ({ ...garaPerRadarDaRiga(r), aperta: true })), p).filter((o) => o.tipo === "pertinente");
  if (opportunita.length === 0) return null;
  const ordinate = opportunita
    .map((o) => ({ o, r: perId.get(o.proceduraId)! }))
    .sort((a, b) => (b.r.data_pubblicazione ?? "").localeCompare(a.r.data_pubblicazione ?? "") || b.r.prima_rilevazione_il.localeCompare(a.r.prima_rilevazione_il) || a.r.id.localeCompare(b.r.id));
  const scelte = ordinate.slice(0, MASSIMO_GARE_RIEPILOGO);
  const gare: GaraRiepilogo[] = scelte.map(({ o, r }) => ({
    ...garaEmailDaArchivio(r, [], x.nascoste, x.origine),
    settori: o.settori
      .filter((s) => eSettore(s.settore))
      .map((s) => ({ settore: s.settore, nome: nomeSettore(s.settore as SettoreRadar), sottocategorie: s.sottocategorie })),
    perche: [motivoPerTe(o, p, r.luogo_regioni ?? [])],
    rilevanza: "A",
  }));
  const id = x.nuovoId();
  const dati: EventoRiepilogo = {
    id,
    impresaId: x.impresaId,
    nomeImpresa: null,
    categoria: "nuove_opportunita",
    tipo: "riepilogo_opportunita",
    versione: x.oggi,
    creatoIl: x.adessoIso,
    gare,
    altreNonIncluse: ordinate.length - scelte.length,
    urlPerTe: urlPerTe(x.origine),
  };
  return {
    id,
    impresaId: x.impresaId,
    categoria: "nuove_opportunita",
    tipo: "riepilogo_opportunita",
    garaChiave: "riepilogo",
    proceduraId: null,
    aggiuntaId: null,
    aggiornamentoId: null,
    versione: x.oggi,
    priorita: PRIORITA_DEL_TIPO.riepilogo_opportunita,
    dati,
  };
}

// ───────────────────────── consegne ─────────────────────────

export type ConsegnaNuova = {
  evento_id: string;
  impresa_id: string;
  destinatario_id: string;
  ruolo: PersonaImpresa["ruolo"];
  chiave: string;
  priorita: number;
  tipo_consegna: "singola";
};

/** La chiave unica della consegna: «<destinatario>:<gara>:<tipo>:<versione>» (deduplica forte richiesta dall'utente). */
export function chiaveConsegna(destinatarioId: string, e: Pick<EventoNuovo, "garaChiave" | "tipo" | "versione">): string {
  return `${destinatarioId}:${e.garaChiave}:${e.tipo}:${e.versione}`.slice(0, 300);
}

/**
 * Le consegne degli eventi appena nati: per ogni evento, le persone della SUA impresa che ricevono la sua categoria (regola unica «riceve»,
 * destinatari-calcoli.ts). Una persona di un'altra impresa non passa mai (e il trigger della 0125 lo rifiuterebbe comunque).
 */
export function consegneDegliEventi(
  eventi: readonly Pick<EventoNuovo, "id" | "impresaId" | "categoria" | "garaChiave" | "tipo" | "versione" | "priorita">[],
  persone: readonly PersonaImpresa[],
  preferenze: ReadonlyMap<string, PreferenzePersona>,
  imprese: ReadonlyMap<string, StatoImpresaNotifiche>,
): ConsegnaNuova[] {
  const perImpresa = new Map<string, PersonaImpresa[]>();
  for (const p of persone) perImpresa.set(p.impresaId, [...(perImpresa.get(p.impresaId) ?? []), p]);
  const esito: ConsegnaNuova[] = [];
  const chiavi = new Set<string>();
  for (const e of eventi) {
    const impresa = imprese.get(e.impresaId);
    if (!impresa) continue;
    for (const p of destinatariCheRicevono(perImpresa.get(e.impresaId) ?? [], preferenze, impresa, e.categoria)) {
      const chiave = chiaveConsegna(p.userId, e);
      if (chiavi.has(chiave)) continue;
      chiavi.add(chiave);
      esito.push({ evento_id: e.id, impresa_id: e.impresaId, destinatario_id: p.userId, ruolo: p.ruolo, chiave, priorita: e.priorita, tipo_consegna: "singola" });
    }
  }
  return esito;
}
