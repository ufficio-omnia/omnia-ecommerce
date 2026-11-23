// Stato calcolato e ALLARMI delle quattro fonti (pacchetto K3 del piano 48C, L2 e L3 del piano 36, C7 dell'analisi 49). Logica PURA:
// riceve le righe del registro dei giri (radar_esecuzioni, 0128), le righe di radar_fonti_stato e l'istante; nessun database, nessuna rete,
// nessun orologio. La legge la pagina «Fonti» della console (B1) con leggiSituazioneFonti (esecuzioni.ts). Soglie del 48C §3.5, approvate
// dall'utente il 23/11 (D2). Le email tecniche arrivano dopo, con la loro autorizzazione.
import { FONTI_ESECUZIONI, type EsitoEsecuzione, type FonteEsecuzione, type ModoEsecuzione } from "./esecuzioni-calcoli";
import { SCHEDE_BANDO_PVL, SCHEDE_ESITO_PVL, motivoScheda } from "./fonti/pvl-calcoli";
import { aggiungiGiorni, giornoRoma } from "./notifiche/calendario";
import { eFeriale, orariPrevisti } from "./programmazione-calcoli";

/** Le colonne del registro che servono agli allarmi (per la lettura della console). */
export const COLONNE_ESECUZIONI_ALLARMI = "fonte, modo, iniziato_il, finito_il, esito, finestre, fonte_richieste, db_richieste, avvisi, gare_nuove, allarmi, errore";
export type RigaEsecuzioneLetta = {
  fonte: string;
  modo: ModoEsecuzione | string;
  iniziato_il: string;
  finito_il: string;
  esito: EsitoEsecuzione | string;
  finestre: unknown;
  fonte_richieste: number;
  db_richieste: number;
  avvisi: Record<string, unknown> | null;
  gare_nuove: number;
  allarmi: string[] | null;
  errore: string | null;
};
/** Le colonne di radar_fonti_stato che servono allo stato calcolato. */
export const COLONNE_STATO_FONTI = "fonte, attiva, ultimo_avvio_il, ultimo_successo_il, ultimo_errore_il, ultimo_errore, conteggi";
export type RigaStatoFonte = {
  fonte: string;
  attiva: boolean;
  ultimo_avvio_il: string | null;
  ultimo_successo_il: string | null;
  ultimo_errore_il: string | null;
  ultimo_errore?: string | null;
  conteggi: Record<string, unknown> | null;
};

/** ok; in errore (l'ultimo esito è un errore più recente dell'ultimo successo); sospesa (dal giro, mai riaccesa da sola); spenta (console). */
export type StatoFonte = "ok" | "in_errore" | "sospesa" | "spenta";
export type GravitaAllarme = "errore" | "avviso" | "informazione";
export type CodiceAllarme =
  | "giro_mancato"
  | "sospesa"
  | "errori_ripetuti"
  | "tetto_ripetuto"
  | "giorno_lavorativo_senza_bandi"
  | "volume_anomalo"
  | "risorse"
  | "tipo_sconosciuto"
  | "registro_mancante"
  // segnalati dal giro stesso (registro, colonna «allarmi»): recupero della PVL (K4), feed di SardegnaCAT (K6), arresto dalla console (K7)
  | "buco_in_recupero"
  | "blocco_incompleto"
  | "buco_possibile"
  | "fermata_dalla_console";
export type Allarme = { codice: CodiceAllarme; gravita: GravitaAllarme; messaggio: string; dal: string | null; dettagli?: Record<string, unknown> };
export type SituazioneFonte = {
  fonte: FonteEsecuzione;
  stato: StatoFonte;
  attiva: boolean;
  erroriConsecutivi: number;
  ultimoGiro: RigaEsecuzioneLetta | null;
  ultimoSuccesso: string | null;
  allarmi: Allarme[];
};

/** Soglie del 48C §3.5 (approvate il 23/11). */
export const SOGLIE_ALLARMI = {
  // giro mancato: nessun giro riuscito entro 60 minuti da un orario previsto (si guarda indietro di 24 ore; 5 minuti di anticipo ammessi)
  giroMancatoMinuti: 60,
  anticipoGiroMinuti: 5,
  finestraOre: 24,
  erroriRipetuti: 2,
  tettoRipetuto: 3,
  giorniSenzaBandi: 2,
  volumeFattore: 3,
  volumeMinimo: 10,
  volumeGiri: 20,
  volumeGiriMinimi: 5,
  risorseRichiesteDb: 300,
  risorseSecondi: 120,
  registroMancanteMinuti: 15,
} as const;

const NOME: Record<FonteEsecuzione, string> = { ted: "TED", pvl: "PVL ANAC", sintel: "Sintel", sardegnacat: "SardegnaCAT" };
const ESEGUITI = new Set(["ok", "errore", "sospesa"]); // i giri veri (non «occupata», «inerte», «gia_eseguito»)
const RIUSCITI = new Set(["ok", "gia_eseguito"]); // un giro riuscito (o un doppio richiamo di un giro già riuscito)
const ms = (s: string | null | undefined) => (s ? Date.parse(s) : Number.NaN);
const oggetto = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const numero = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const breve = (s: unknown, n = 200) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const quando = (iso: string) => new Date(iso).toLocaleString("it-IT", { timeZone: "Europe/Rome", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** LO stato calcolato di una fonte (L2), senza colonne nuove: l'errore è «attuale» solo se più recente dell'ultimo successo. */
export function statoFonte(s: Pick<RigaStatoFonte, "attiva" | "ultimo_successo_il" | "ultimo_errore_il" | "conteggi">): StatoFonte {
  const successo = ms(s.ultimo_successo_il);
  const piuRecente = (t: number) => Number.isFinite(t) && (!Number.isFinite(successo) || t > successo);
  if (!s.attiva) return piuRecente(ms(String(oggetto(oggetto(s.conteggi).sospensione).il ?? ""))) ? "sospesa" : "spenta";
  return piuRecente(ms(s.ultimo_errore_il)) ? "in_errore" : "ok";
}

/** C7: i tipi o le modalità che il connettore non conosce, dagli avvisi di un giro (solo codici, mai dati). */
export function tipiSconosciuti(fonte: FonteEsecuzione, avvisi: Record<string, unknown> | null): string[] {
  const a = oggetto(avvisi);
  if (fonte === "pvl") {
    // schede che non sono bandi né esiti né famiglie escluse note (P7/P8, affidamenti, modifiche): «altra_scheda»; di queste sono NOTE i
    // sistemi di qualificazione (P*_15) e i concorsi di progettazione (P*_23, P*_24). Le altre sono un codice NUOVO da guardare
    return Object.keys(oggetto(a.per_scheda))
      .filter((s) => !SCHEDE_BANDO_PVL.test(s) && !SCHEDE_ESITO_PVL.test(s) && motivoScheda(s) === "altra_scheda" && !/^P\d_(15|2[34])(_\d+)*$/.test(s))
      .sort();
  }
  const esclusi = oggetto(a.esclusi);
  if (fonte === "sintel") return numero(esclusi.modalita_sconosciuta) > 0 ? [`modalita_sconosciuta×${numero(esclusi.modalita_sconosciuta)}`] : [];
  if (fonte === "sardegnacat") return numero(esclusi.tipo_sconosciuto) > 0 ? [`tipo_sconosciuto×${numero(esclusi.tipo_sconosciuto)}`] : [];
  return [];
}

const MESSAGGI_DEL_GIRO: Partial<Record<CodiceAllarme, [GravitaAllarme, string]>> = {
  buco_in_recupero: ["avviso", "Un periodo non letto è entrato tra i buchi da recuperare"],
  blocco_incompleto: ["avviso", "Un blocco del recupero non torna con il conteggio dichiarato dalla fonte"],
  buco_possibile: ["avviso", "Dopo un fermo lungo qualche avviso può essere uscito dal feed"],
  fermata_dalla_console: ["informazione", "Giro fermato dalla console a metà"],
};
const ORDINE: Record<GravitaAllarme, number> = { errore: 0, avviso: 1, informazione: 2 };

/**
 * Situazione e allarmi delle quattro fonti (sempre tutte e quattro, nell'ordine di FONTI_ESECUZIONI). `righe`: le righe del registro degli
 * ultimi giorni (in qualunque ordine, anche di altre fonti); `stato`: le righe di radar_fonti_stato; `cronAttivi`: le fonti con i giri
 * programmati accesi (programmazione-calcoli.ts, cronAttiviDa); senza, «giro_mancato» vale per ogni fonte accesa.
 */
export function allarmiFonti(
  righe: readonly RigaEsecuzioneLetta[],
  stato: readonly RigaStatoFonte[],
  adesso: Date,
  opzioni: { cronAttivi?: ReadonlySet<FonteEsecuzione> } = {},
): SituazioneFonte[] {
  const ora = adesso.getTime();
  return FONTI_ESECUZIONI.map((fonte) => {
    const s = stato.find((x) => x.fonte === fonte) ?? { fonte, attiva: false, ultimo_avvio_il: null, ultimo_successo_il: null, ultimo_errore_il: null, conteggi: null };
    const mie = righe.filter((r) => r.fonte === fonte && Number.isFinite(ms(r.iniziato_il))).sort((a, b) => ms(b.iniziato_il) - ms(a.iniziato_il));
    const veri = mie.filter((r) => ESEGUITI.has(r.esito));
    const st = statoFonte(s);
    const allarmi: Allarme[] = [];
    const aggiungi = (codice: CodiceAllarme, gravita: GravitaAllarme, messaggio: string, dal: string | null, dettagli?: Record<string, unknown>) => {
      if (!allarmi.some((a) => a.codice === codice)) allarmi.push({ codice, gravita, messaggio, dal, ...(dettagli ? { dettagli } : {}) });
    };

    // sospesa (dal giro: 401, 403, 429, formato, conteggio anomalo) — si riaccende SOLO dalla console
    if (st === "sospesa") {
      const sosp = oggetto(oggetto(s.conteggi).sospensione);
      aggiungi("sospesa", "errore", `${NOME[fonte]} sospesa il ${quando(String(sosp.il))}: ${breve(sosp.motivo) || "motivo non indicato"}. Si riaccende solo dalla console.`, String(sosp.il));
    }
    // errori ripetuti
    let erroriConsecutivi = 0;
    for (const r of veri) {
      if (r.esito === "ok") break;
      erroriConsecutivi++;
    }
    if (erroriConsecutivi >= SOGLIE_ALLARMI.erroriRipetuti) aggiungi("errori_ripetuti", "errore", `Ultimi ${erroriConsecutivi} giri non riusciti: ${breve(veri[0]?.errore) || breve(s.ultimo_errore) || "errore non indicato"}`, veri[erroriConsecutivi - 1]?.iniziato_il ?? null, { erroriConsecutivi });

    // giro mancato: un orario previsto (cron acceso, fonte accesa) senza un giro riuscito entro 60 minuti. Si contano solo gli orari DOPO il
    // primo giro registrato della fonte (prima il registro o la fonte potevano non esserci: niente falsi allarmi all'accensione)
    const cron = opzioni.cronAttivi ? opzioni.cronAttivi.has(fonte) : true;
    if (s.attiva && cron && mie.length > 0) {
      const primo = ms(mie[mie.length - 1].iniziato_il);
      const da = new Date(Math.max(ora - SOGLIE_ALLARMI.finestraOre * 3_600_000, primo));
      const a = new Date(ora - SOGLIE_ALLARMI.giroMancatoMinuti * 60_000);
      const mancati = orariPrevisti(fonte, da, a).filter((t) => {
        const inizio = t.getTime() - SOGLIE_ALLARMI.anticipoGiroMinuti * 60_000, fine = t.getTime() + SOGLIE_ALLARMI.giroMancatoMinuti * 60_000;
        return !mie.some((r) => RIUSCITI.has(r.esito) && ms(r.iniziato_il) >= inizio && ms(r.iniziato_il) <= fine);
      });
      if (mancati.length) {
        const ultimo = mancati[mancati.length - 1].toISOString();
        aggiungi("giro_mancato", "errore", `Nessun giro riuscito per il giro previsto delle ${quando(ultimo)}${mancati.length > 1 ? ` (giri mancati nelle ultime ${SOGLIE_ALLARMI.finestraOre} ore: ${mancati.length})` : ""}`, ultimo, { mancati: mancati.map((t) => t.toISOString()) });
      }
    }

    // giro rimasto a metà per il tetto di richieste, più volte di fila (solo incrementale: nel recupero è normale)
    let incompleti = 0;
    for (const r of veri) {
      if (r.esito !== "ok" || r.modo === "recupero" || oggetto(r.finestre).giro_finito !== false) break;
      incompleti++;
    }
    if (incompleti >= SOGLIE_ALLARMI.tettoRipetuto) aggiungi("tetto_ripetuto", "avviso", `Ultimi ${incompleti} giri fermati prima della fine (tetto di richieste o tempo): il giro successivo riprende, ma non riesce a finire`, veri[incompleti - 1]?.iniziato_il ?? null, { incompleti });

    // giorni lavorativi senza bandi (PVL e TED pubblicano tutti i giorni lavorativi): gli ultimi 2 lavorativi CONCLUSI, con giri riusciti
    if (fonte === "pvl" || fonte === "ted") {
      const giorni: string[] = [];
      for (let g = aggiungiGiorni(giornoRoma(adesso), -1); giorni.length < SOGLIE_ALLARMI.giorniSenzaBandi && g >= aggiungiGiorni(giornoRoma(adesso), -10); g = aggiungiGiorni(g, -1)) if (eFeriale(g)) giorni.push(g);
      const bandiDel = (g: string) => {
        const ok = mie.filter((r) => r.esito === "ok" && giornoRoma(r.iniziato_il) === g);
        if (!ok.length) return null;
        return ok.reduce((n, r) => n + (fonte === "pvl" ? numero(oggetto(r.avvisi).bandi) : numero(oggetto(oggetto(r.avvisi).bandi).letti)), 0);
      };
      const conti = giorni.map(bandiDel);
      if (giorni.length === SOGLIE_ALLARMI.giorniSenzaBandi && conti.every((n) => n === 0)) aggiungi("giorno_lavorativo_senza_bandi", "informazione", `Nessun bando letto negli ultimi ${giorni.length} giorni lavorativi (${giorni.join(", ")}): la fonte li pubblica ogni giorno lavorativo`, null, { giorni });
    }

    const ultimo = veri[0] ?? null;
    if (ultimo && ultimo.esito === "ok") {
      // volume anomalo: gare nuove oltre il triplo della media dei giri precedenti
      const precedenti = veri.filter((r) => r.esito === "ok").slice(1, 1 + SOGLIE_ALLARMI.volumeGiri);
      const media = precedenti.length ? precedenti.reduce((n, r) => n + numero(r.gare_nuove), 0) / precedenti.length : 0;
      if (precedenti.length >= SOGLIE_ALLARMI.volumeGiriMinimi && media > 0 && numero(ultimo.gare_nuove) >= SOGLIE_ALLARMI.volumeMinimo && numero(ultimo.gare_nuove) > SOGLIE_ALLARMI.volumeFattore * media)
        aggiungi("volume_anomalo", "avviso", `Gare nuove nell'ultimo giro: ${numero(ultimo.gare_nuove)}, oltre il triplo della media (${media.toFixed(1)})`, ultimo.iniziato_il, { gareNuove: numero(ultimo.gare_nuove), media });
      // C7: tipi o modalità sconosciuti
      const nuovi = tipiSconosciuti(fonte, ultimo.avvisi);
      if (nuovi.length) aggiungi("tipo_sconosciuto", "avviso", `Tipi di avviso non riconosciuti nell'ultimo giro: ${nuovi.join(", ")}. Da guardare: potrebbero essere gare perse`, ultimo.iniziato_il, { codici: nuovi });
    }
    // risorse dell'ultimo giro vero
    if (ultimo) {
      const secondi = (ms(ultimo.finito_il) - ms(ultimo.iniziato_il)) / 1000;
      if (numero(ultimo.db_richieste) > SOGLIE_ALLARMI.risorseRichiesteDb || secondi > SOGLIE_ALLARMI.risorseSecondi)
        aggiungi("risorse", "avviso", `Ultimo giro pesante: ${numero(ultimo.db_richieste)} richieste al database, ${Math.round(secondi)} secondi`, ultimo.iniziato_il, { richiesteDb: numero(ultimo.db_richieste), secondi: Math.round(secondi) });
    }
    // registro mancante: un giro avviato (blocco preso) che non ha lasciato la sua riga (processo caduto o registro non scritto)
    const avvio = ms(s.ultimo_avvio_il);
    if (Number.isFinite(avvio) && avvio < ora - SOGLIE_ALLARMI.registroMancanteMinuti * 60_000 && !mie.some((r) => ms(r.finito_il) >= avvio - 60_000))
      aggiungi("registro_mancante", "avviso", `Il giro avviato alle ${quando(String(s.ultimo_avvio_il))} non ha lasciato la sua riga nel registro (caduto o registro non scritto)`, String(s.ultimo_avvio_il));
    // segnalati dal giro stesso (ultima riga)
    for (const nome of mie[0]?.allarmi ?? []) {
      const m = MESSAGGI_DEL_GIRO[nome as CodiceAllarme];
      if (m) aggiungi(nome as CodiceAllarme, m[0], m[1], mie[0].iniziato_il);
    }

    allarmi.sort((x, y) => ORDINE[x.gravita] - ORDINE[y.gravita]);
    return { fonte, stato: st, attiva: s.attiva, erroriConsecutivi, ultimoGiro: mie[0] ?? null, ultimoSuccesso: s.ultimo_successo_il, allarmi };
  });
}
