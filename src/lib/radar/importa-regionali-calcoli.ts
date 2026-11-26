// Fonti regionali e piattaforme di gara (fase B2a: Sintel e SardegnaCAT; poi le altre) nel motore di unione unico: dai bandi normalizzati dei
// connettori alla forma che usa unione-calcoli.ts. Logica pura, provata da scripts/verifica-radar-b2a.ts.
//
// Differenze dalle fonti europee e nazionali, e come si gestiscono:
//   - una procedura = UN avviso nella fonte, aggiornato sul posto (niente numeri di versione): la provenienza è una riga per procedura
//     (id_fonte = id_procedura_fonte = identificativo della procedura), e la versione è il giorno (Sintel: giorno in cui OMNIA ha visto il
//     contenuto cambiato) o l'istante dell'ultima modifica (SardegnaCAT). Un contenuto invariato (stessa impronta) non scrive nulla;
//   - ogni cambiamento registrato ha un identificativo proprio («<procedura>@<versione>»): due proroghe in giorni diversi sono due righe;
//   - la chiave della gara nata da queste fonti è l'identificativo della piattaforma («sintel:<id>», «sardegnacat:<IdMsg>»), che è anche
//     piattaforma_id: così la stessa gara letta da TED (collegamento ai documenti) si riconosce con una chiave esatta.
import type { BandoSintel } from "./fonti/sintel-calcoli";
import type { BandoAflink } from "./fonti/aflink-calcoli";
import type { BandoIntercenter } from "./fonti/intercenter-calcoli";
import { giornoDiRoma, type ScadenzaTed } from "./fonti/ted-calcoli";
import type { RecordProcedura } from "./fonti/tipi";
import { rigaDaBando, type RigaProcedura } from "./importa-calcoli";
import { perArchivio, type OpportunitaArchivio } from "./opportunita-calcoli";
import type { SettoreRadar } from "./settori";
import type { IdRegione } from "./territorio";
import type { VersioneFonte } from "./unione-calcoli";

export type FonteRegionale = "sintel" | "sardegnacat" | "sater";

// Le fonti regionali GESTITE da console e giri programmati. Fase 2: anche SATER (decisione dell'utente del 26/11: in produzione), con la
// sua variabile di produzione, il suo cron e la riga della 0134 (spenta e nascosta ai clienti).
export const FONTI_REGIONALI = ["sintel", "sardegnacat", "sater"] as const satisfies readonly FonteRegionale[];
export type FonteRegionaleGestita = (typeof FONTI_REGIONALI)[number];

export type BandoRegionale = {
  fonte: FonteRegionale;
  // identificativo della procedura nella fonte (id_fonte e id_procedura_fonte della provenienza)
  idProcedura: string;
  piattaformaId: string | null;
  versione: VersioneFonte;
  // identificativo del cambiamento nel registro: «<procedura>@<versione>»
  idCambiamento: string;
  record: RecordProcedura;
  opportunita: OpportunitaArchivio;
  settori: SettoreRadar[];
  metodoSettore: "cpv" | "parole_chiave";
  regioni: IdRegione[];
  scadenzaFonte: string | null;
  lottiScadenze: (ScadenzaTed | null)[];
  lottiDocumenti: (string | null)[];
  tipoAvvisoFonte: string | null;
  pubblicatoIl: string | null;
  mancanti: string[];
  // fase B4 (26B §6.2 punto 5): che cosa DICHIARA la fonte sulla versione (SardegnaCAT «rettificato»); null se nulla
  dichiarazione: string | null;
};

export function bandoDaSintel(b: BandoSintel, oggi: string): BandoRegionale | null {
  const opp = perArchivio(b.opportunita);
  if (!opp) return null;
  const id = b.meta.idProcedura;
  return {
    fonte: "sintel",
    idProcedura: id,
    piattaformaId: b.meta.idPiattaforma,
    versione: { fonte: "sintel", id: `${id}@${oggi}`, giorno: oggi, istante: null, ted: null },
    idCambiamento: `${id}@${oggi}`,
    record: b.record,
    opportunita: opp,
    settori: b.settori,
    metodoSettore: b.metodoSettore,
    regioni: b.regioni,
    scadenzaFonte: b.scadenzaFonte,
    lottiScadenze: b.lottiScadenze,
    lottiDocumenti: b.lottiDocumenti,
    tipoAvvisoFonte: b.meta.modalita,
    pubblicatoIl: null,
    mancanti: b.mancanti,
    // Sintel non dichiara rettifiche (solo istantanee giornaliere): mai una dichiarazione
    dichiarazione: null,
  };
}

export function bandoDaAflink(b: BandoAflink, oggi: string): BandoRegionale | null {
  const opp = perArchivio(b.opportunita);
  if (!opp) return null;
  const id = b.meta.idMsg;
  // senza «dataUltimaModifica» (istanze dove è facoltativa) la versione è il giorno in cui OMNIA vede il contenuto, come per Sintel: un
  // contenuto invariato (stessa impronta) non scrive nulla
  const versione = b.meta.ultimaModifica ?? oggi;
  const giornoModifica = versione.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? oggi;
  return {
    fonte: b.fonte,
    idProcedura: id,
    piattaformaId: b.meta.idPiattaforma,
    versione: { fonte: b.fonte, id: `${id}@${versione}`, giorno: giornoModifica, istante: b.meta.istanteModifica, ted: null },
    idCambiamento: `${id}@${versione}`.slice(0, 200),
    record: b.record,
    opportunita: opp,
    settori: b.settori,
    metodoSettore: b.metodoSettore,
    regioni: b.regioni,
    scadenzaFonte: b.scadenzaFonte,
    lottiScadenze: b.lottiScadenze,
    lottiDocumenti: b.lottiDocumenti,
    tipoAvvisoFonte: b.record.tipoAvviso,
    pubblicatoIl: b.record.dataPubblicazione,
    mancanti: b.mancanti,
    // il segnale «Bando Rettificato / In Rettifica» del feed non si perde più: arriva al registro come dichiarazione della fonte
    // «Procedura Ripristinata» (23/11, scelta (a) dell'utente): arriva all'unione, che può riportare la gara dallo stato «annullata»
    dichiarazione: b.ripristinato ? "ripristinato" : b.rettificato ? "rettificato" : null,
  };
}

// SATER (Fase 2): un bando dell'API del portale Intercent-ER. L'identificativo è quello del collegamento «trovabando» (piattaforma_id e
// chiave della gara); la versione è la data di modifica dell'elemento nel portale, o il giorno in cui OMNIA lo vede (come Sintel).
export function bandoDaIntercenter(b: BandoIntercenter, oggi: string): BandoRegionale | null {
  const opp = perArchivio(b.opportunita);
  if (!opp) return null;
  const id = b.meta.idProcedura;
  const versione = b.meta.ultimaModifica ?? oggi;
  return {
    fonte: "sater",
    idProcedura: id,
    piattaformaId: b.meta.idPiattaforma,
    versione: { fonte: "sater", id: `${id}@${versione}`, giorno: b.meta.ultimaModifica ? giornoDiRoma(new Date(b.meta.ultimaModifica)) : oggi, istante: b.meta.ultimaModifica, ted: null },
    idCambiamento: `${id}@${versione}`.slice(0, 200),
    record: b.record,
    opportunita: opp,
    settori: b.settori,
    metodoSettore: b.metodoSettore,
    regioni: b.regioni,
    scadenzaFonte: b.scadenzaFonte,
    lottiScadenze: b.lottiScadenze,
    lottiDocumenti: b.lottiDocumenti,
    tipoAvvisoFonte: b.record.tipoAvviso,
    pubblicatoIl: b.record.dataPubblicazione,
    mancanti: b.mancanti,
    // l'elenco del portale non dichiara rettifiche: mai una dichiarazione
    dichiarazione: null,
  };
}

// La riga della gara costruita da UN bando regionale (poi unita alla gara esistente da unisciVersione, come per TED e PVL).
export function rigaDaBandoRegionale(b: BandoRegionale, adesso: Date): RigaProcedura {
  const r = rigaDaBando(
    { record: { ...b.record, chiaveProcedura: b.piattaformaId ?? b.record.chiaveProcedura }, regioni: b.regioni, enteTipo: null, scadenzaFonte: b.scadenzaFonte, settori: b.settori, metodoSettore: b.metodoSettore, meta: { data: b.versione.giorno, numero: `${b.fonte}:${b.versione.id}` } },
    null,
    adesso,
  );
  return { ...r, piattaforma_id: b.piattaformaId ?? r.piattaforma_id, tipo_opportunita: b.opportunita.tipo, partecipazione: b.opportunita.partecipazione };
}

// Statistiche di un giro (registrate in radar_fonti_stato.conteggi e mostrate in console).
export type StatisticheRegionali = {
  letti: number;
  esclusi: Record<string, number>;
  invariati: number;
  nuove: number;
  aggiornate: number;
  suGaraEsistente: Record<string, number>; // via: procedura, piattaforma, cig
  suGaraCollegata: number;
  rettifiche: number;
  annullate: number;
  lotti: number;
  cigAssegnati: number;
  cigScartati: number;
  conflitti: number;
  nonApplicateNascosta: number;
  aggiunteCollegate: number;
  collegateDoppie: number;
  proposte: number;
  // classificazioni diverse tra le fonti della stessa gara, segnalate all'amministratore
  ambiguita: number;
  mancanti: Record<string, number>;
};

export function statisticheRegionaliVuote(): StatisticheRegionali {
  return { letti: 0, esclusi: {}, invariati: 0, nuove: 0, aggiornate: 0, suGaraEsistente: {}, suGaraCollegata: 0, rettifiche: 0, annullate: 0, lotti: 0, cigAssegnati: 0, cigScartati: 0, conflitti: 0, nonApplicateNascosta: 0, aggiunteCollegate: 0, collegateDoppie: 0, proposte: 0, ambiguita: 0, mancanti: {} };
}

export function conta(m: Record<string, number>, k: string, n = 1): void {
  m[k] = (m[k] ?? 0) + n;
}
