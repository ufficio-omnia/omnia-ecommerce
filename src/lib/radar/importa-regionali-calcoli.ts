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
import type { ScadenzaTed } from "./fonti/ted-calcoli";
import type { RecordProcedura } from "./fonti/tipi";
import { rigaDaBando, type RigaProcedura } from "./importa-calcoli";
import { perArchivio, type OpportunitaArchivio } from "./opportunita-calcoli";
import type { SettoreRadar } from "./settori";
import type { IdRegione } from "./territorio";
import type { VersioneFonte } from "./unione-calcoli";

export type FonteRegionale = "sintel" | "sardegnacat";

export const FONTI_REGIONALI: readonly FonteRegionale[] = ["sintel", "sardegnacat"];

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
  };
}

export function bandoDaAflink(b: BandoAflink, oggi: string): BandoRegionale | null {
  const opp = perArchivio(b.opportunita);
  if (!opp) return null;
  const id = b.meta.idMsg;
  const giornoModifica = b.meta.ultimaModifica.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? oggi;
  return {
    fonte: b.fonte,
    idProcedura: id,
    piattaformaId: b.meta.idPiattaforma,
    versione: { fonte: b.fonte, id: `${id}@${b.meta.ultimaModifica}`, giorno: giornoModifica, istante: b.meta.istanteModifica, ted: null },
    idCambiamento: `${id}@${b.meta.ultimaModifica}`.slice(0, 200),
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
  mancanti: Record<string, number>;
};

export function statisticheRegionaliVuote(): StatisticheRegionali {
  return { letti: 0, esclusi: {}, invariati: 0, nuove: 0, aggiornate: 0, suGaraEsistente: {}, suGaraCollegata: 0, rettifiche: 0, annullate: 0, lotti: 0, cigAssegnati: 0, cigScartati: 0, conflitti: 0, nonApplicateNascosta: 0, aggiunteCollegate: 0, collegateDoppie: 0, proposte: 0, mancanti: {} };
}

export function conta(m: Record<string, number>, k: string, n = 1): void {
  m[k] = (m[k] ?? 0) + n;
}
