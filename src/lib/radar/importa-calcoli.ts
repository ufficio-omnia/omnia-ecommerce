// Regole dell'importazione nell'archivio pubblico: quale versione di un avviso vale, che cosa è cambiato (rettifica, proroga, annullamento,
// esito), quando un cambiamento potrà generare una notifica. Logica pura, provata da scripts/verifica-radar-b1.ts.
//
// Regole (richieste del 16/11/2026, approvazione di B1):
//   - nessun doppione: una procedura = una chiave stabile («ted:<identificativo della procedura>»); un avviso = una riga di provenienza;
//   - si applica solo un avviso PIÙ RECENTE di quello già letto (data, poi numero di pubblicazione); uno più vecchio aggiunge solo la provenienza;
//   - la data di pubblicazione della gara resta quella del primo avviso; la prima rilevazione non si riscrive mai;
//   - un cambiamento è «notificabile» solo se arriva dalla sincronizzazione quotidiana E la gara è ancora aperta: niente notifiche per gli
//     avvisi dello storico recuperato, né per gare già scadute.
import { giornoDiRoma, ordinePubblicazione, type BandoTed } from "./fonti/ted-calcoli";
import { idPiattaformaDaUrl } from "./fonti/piattaforme-calcoli";
import { opportunitaDaTipoAvviso, type PartecipazioneArchivio, type TipoOpportunitaArchivio } from "./opportunita-calcoli";
import { titoloBreve } from "./sintesi-calcoli";

export type ModoImportazione = "recupero" | "incrementale";

export type StatoProcedura = "aperta" | "scaduta" | "annullata" | "aggiudicata" | "chiusa_senza_aggiudicazione" | "sospesa" | "sconosciuto";

// Le colonne di radar_procedure scritte dall'importazione (prima_rilevazione_il e id restano al database).
export type RigaProcedura = {
  chiave: string;
  oggetto: string;
  oggetto_breve: string;
  descrizione: string | null;
  sa_codice_fiscale: string | null;
  sa_denominazione: string | null;
  sa_comune: string | null;
  sa_provincia: string | null;
  sa_regione: string | null;
  codice_nuts: string | null;
  luogo_regioni: string[];
  ente_tipo: string | null;
  tipo_avviso: string | null;
  tipo_procedura: string | null;
  criterio_aggiudicazione: string | null;
  natura_contratto: string | null;
  settori_speciali: boolean | null;
  data_pubblicazione: string | null;
  scadenza_giorno: string | null;
  scadenza_offerte: string | null;
  scadenza_ora_indicata: boolean;
  scadenza_fonte: string | null;
  valore_stimato: number | null;
  durata_mesi: number | null;
  n_lotti: number;
  stato: StatoProcedura;
  rettificata: boolean;
  url_avviso: string | null;
  url_documenti: string | null;
  piattaforma_host: string | null;
  cpv_principale: string | null;
  cpv_tutti: string[];
  settori: string[];
  metodo_settore: "cpv" | "parole_chiave";
  // fase B2a (0120): base d'asta (Sintel, SardegnaCAT; null per TED e PVL), identificativo della procedura sulla piattaforma di gara
  // (chiave esatta per unire la stessa gara letta da due fonti), tipo di opportunità e partecipazione
  valore_base: number | null;
  piattaforma_id: string | null;
  tipo_opportunita: TipoOpportunitaArchivio | null;
  partecipazione: PartecipazioneArchivio | null;
  ultima_versione_il: string;
  ultima_versione_id: string;
  ultima_rilevazione_il: string;
  aggiornata_il: string;
};

export type VersioneLetta = { data: string; numero: string };

// a è più recente di b? Prima la data di pubblicazione, poi il numero di pubblicazione (anno, numero).
export function piuRecente(a: VersioneLetta, b: VersioneLetta | null): boolean {
  if (!b) return true;
  if (a.data !== b.data) return a.data > b.data;
  const oa = ordinePubblicazione(a.numero);
  const ob = ordinePubblicazione(b.numero);
  if (!oa || !ob) return false;
  return oa[0] !== ob[0] ? oa[0] > ob[0] : oa[1] > ob[1];
}

function host(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

// Un avviso già normalizzato, da qualunque fonte (TED o PVL): quello che serve a costruire la riga della gara.
export type BandoNormalizzato = Pick<BandoTed, "record" | "regioni" | "enteTipo" | "scadenzaFonte" | "settori" | "metodoSettore"> & { meta: { data: string; numero: string } };

// La riga della procedura dopo aver applicato un avviso (più recente) a quella già in archivio (o a nessuna).
export function rigaDaBando(b: BandoNormalizzato, precedente: RigaProcedura | null, adesso: Date): RigaProcedura {
  const r = b.record;
  const iso = adesso.toISOString();
  // annullata dalla fonte = annullata; un esito già registrato non torna «aperta» per una correzione successiva del bando
  const statoPrecedente = precedente?.stato ?? null;
  const stato: StatoProcedura = r.annullata
    ? "annullata"
    : statoPrecedente === "aggiudicata" || statoPrecedente === "chiusa_senza_aggiudicazione" || statoPrecedente === "annullata"
      ? statoPrecedente
      : "aperta";
  const dataPubblicazione = precedente?.data_pubblicazione && r.dataPubblicazione ? (precedente.data_pubblicazione < r.dataPubblicazione ? precedente.data_pubblicazione : r.dataPubblicazione) : (precedente?.data_pubblicazione ?? r.dataPubblicazione);
  return {
    chiave: r.chiaveProcedura,
    oggetto: r.oggetto,
    oggetto_breve: titoloBreve(r.oggetto),
    descrizione: r.descrizione,
    sa_codice_fiscale: r.ente.codiceFiscale,
    sa_denominazione: r.ente.denominazione,
    sa_comune: r.ente.comune,
    sa_provincia: r.ente.provincia,
    sa_regione: r.ente.regione,
    codice_nuts: r.ente.nuts,
    luogo_regioni: b.regioni,
    ente_tipo: b.enteTipo,
    tipo_avviso: r.tipoAvviso,
    tipo_procedura: r.tipoProcedura,
    criterio_aggiudicazione: r.criterioAggiudicazione,
    natura_contratto: r.natura,
    settori_speciali: r.settoriSpeciali,
    data_pubblicazione: dataPubblicazione,
    scadenza_giorno: r.scadenzaGiorno,
    scadenza_offerte: r.scadenzaOfferte,
    scadenza_ora_indicata: r.scadenzaOraIndicata,
    scadenza_fonte: b.scadenzaFonte,
    valore_stimato: r.valoreStimato,
    durata_mesi: r.durataMesi,
    n_lotti: r.lotti.length,
    stato,
    rettificata: precedente?.rettificata ?? false,
    url_avviso: r.urlAvviso,
    url_documenti: r.urlDocumenti,
    piattaforma_host: host(r.urlDocumenti),
    cpv_principale: r.cpvPrincipale,
    cpv_tutti: r.cpvTutti,
    settori: b.settori,
    metodo_settore: b.metodoSettore,
    valore_base: r.valoreBase,
    piattaforma_id: idPiattaformaDaUrl(r.urlDocumenti),
    tipo_opportunita: opportunitaDaTipoAvviso(r.tipoAvviso)?.tipo ?? null,
    partecipazione: opportunitaDaTipoAvviso(r.tipoAvviso)?.partecipazione ?? null,
    ultima_versione_il: b.meta.data,
    ultima_versione_id: b.meta.numero,
    ultima_rilevazione_il: iso,
    aggiornata_il: iso,
  };
}

export type TipoAggiornamento = "nuova" | "rettifica" | "proroga" | "annullamento" | "esito" | "correzione_dati";

export type Cambiamento = { tipo: TipoAggiornamento; campo: string | null; prima: string | null; dopo: string | null };

function testo(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v);
}

function stessoValore(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) < 0.005;
}

// I cambiamenti che contano per chi segue la gara, tra la versione in archivio e quella nuova.
export function cambiamentiTraVersioni(prima: RigaProcedura, dopo: RigaProcedura): Cambiamento[] {
  const c: Cambiamento[] = [];
  if (dopo.stato === "annullata" && prima.stato !== "annullata") c.push({ tipo: "annullamento", campo: "stato", prima: prima.stato, dopo: "annullata" });
  const sPrima = { giorno: prima.scadenza_giorno, iso: prima.scadenza_offerte };
  const sDopo = { giorno: dopo.scadenza_giorno, iso: dopo.scadenza_offerte };
  if (valoreScadenza(sPrima) !== valoreScadenza(sDopo)) {
    // proroga: giorno successivo, oppure stesso giorno con un'ora più tarda
    const proroga = !!sPrima.giorno && !!sDopo.giorno && (sDopo.giorno > sPrima.giorno || (sDopo.giorno === sPrima.giorno && !!sPrima.iso && !!sDopo.iso && Date.parse(sDopo.iso) > Date.parse(sPrima.iso)));
    c.push({ tipo: proroga ? "proroga" : "rettifica", campo: "scadenza_offerte", prima: valoreScadenza(sPrima), dopo: valoreScadenza(sDopo) });
  }
  if (!stessoValore(prima.valore_stimato, dopo.valore_stimato)) c.push({ tipo: "rettifica", campo: "valore_stimato", prima: testo(prima.valore_stimato), dopo: testo(dopo.valore_stimato) });
  if (prima.oggetto !== dopo.oggetto) c.push({ tipo: "rettifica", campo: "oggetto", prima: prima.oggetto.slice(0, 2000), dopo: dopo.oggetto.slice(0, 2000) });
  if ((prima.url_documenti ?? null) !== (dopo.url_documenti ?? null)) c.push({ tipo: "rettifica", campo: "url_documenti", prima: prima.url_documenti, dopo: dopo.url_documenti });
  if (prima.n_lotti !== dopo.n_lotti) c.push({ tipo: "rettifica", campo: "n_lotti", prima: String(prima.n_lotti), dopo: String(dopo.n_lotti) });
  return c;
}

// La scadenza di una gara: il giorno e, SOLO se l'ora è indicata, l'istante. Mai un'ora presunta (regola del progetto, migrazione 0102).
export type Scadenza = { giorno: string | null; iso: string | null };

// Come si conserva nel registro dei cambiamenti: l'istante se c'è l'ora, altrimenti il solo giorno (AAAA-MM-GG).
export function valoreScadenza(s: Scadenza): string | null {
  return s.iso ?? s.giorno;
}

export function scadenzaDaValore(v: string | null): Scadenza {
  if (!v) return { giorno: null, iso: null };
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? { giorno: v, iso: null } : { giorno: giornoDiRoma(new Date(v)), iso: v };
}

// Una gara è aperta in questo momento? Stato «aperta» e: nessuna scadenza; oppure un giorno futuro; oppure oggi, senza ora (aperta per tutto
// il giorno) o con un'ora non ancora passata. Un giorno già finito è scaduto, con o senza ora.
export function aperta(stato: StatoProcedura, s: Scadenza, adesso: Date): boolean {
  if (stato !== "aperta") return false;
  if (!s.giorno) return true;
  const oggi = giornoDiRoma(adesso);
  if (s.giorno !== oggi) return s.giorno > oggi;
  if (!s.iso) return true;
  const t = Date.parse(s.iso);
  return Number.isNaN(t) ? true : t > adesso.getTime();
}

export function notificabile(modo: ModoImportazione, stato: StatoProcedura, s: Scadenza, adesso: Date): boolean {
  return modo === "incrementale" && aperta(stato, s, adesso);
}

// Lo stato dopo un avviso di esito: una gara annullata resta annullata; altrimenti vale l'esito, se ne dice uno.
export function statoDopoEsito(attuale: StatoProcedura, esito: "aggiudicata" | "chiusa_senza_aggiudicazione" | null): StatoProcedura | null {
  if (!esito || attuale === "annullata" || attuale === esito) return null;
  return esito;
}

// Stato da mostrare: «scaduta» si calcola dalla data, non si scrive.
export function statoMostrato(stato: StatoProcedura, s: Scadenza, adesso: Date): StatoProcedura {
  if (stato === "aperta" && s.giorno && !aperta(stato, s, adesso)) return "scaduta";
  return stato;
}

export const ETICHETTA_STATO: Record<StatoProcedura, string> = {
  aperta: "Aperta",
  scaduta: "Scaduta",
  annullata: "Annullata",
  aggiudicata: "Aggiudicata",
  chiusa_senza_aggiudicazione: "Chiusa senza aggiudicazione",
  sospesa: "Sospesa",
  sconosciuto: "Stato non indicato",
};
