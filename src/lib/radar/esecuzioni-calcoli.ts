// Registro dei giri delle fonti (tabella radar_esecuzioni, migrazione 0128; L3 del piano 36, pacchetto K2 del piano 48C). Logica PURA:
// dal risultato di un importatore (TED, PVL, Sintel, SardegnaCAT) alla riga del registro, valida per TUTTI i vincoli della 0128.
// Nessun dato di persone: conteggi, finestre lette, esiti e un errore ripulito. Provata da scripts/verifica-radar-esecuzioni.ts e, sui
// vincoli veri, su Postgres isolato (scripts/prova-isolata/esegui-prova-esecuzioni.mjs).
import { erroreDaConservare } from "./lavori-calcoli";

export const FONTI_ESECUZIONI = ["ted", "pvl", "sintel", "sardegnacat"] as const;
export type FonteEsecuzione = (typeof FONTI_ESECUZIONI)[number];
export type ModoEsecuzione = "incrementale" | "recupero" | "finestra" | "manuale";
export type EsitoEsecuzione = "ok" | "errore" | "sospesa" | "occupata" | "inerte" | "gia_eseguito";
/** Chi ha lanciato il giro: il cron, il pulsante della console («Esegui un giro adesso»), uno script dello staging. */
export type OrigineGiro = "programmato" | "console" | "script";

/** Le righe si conservano 90 giorni: il giro stesso cancella quelle più vecchie della sua fonte. */
export const GIORNI_CONSERVAZIONE_ESECUZIONI = 90;

/** Limiti della 0128 (octet_length del testo jsonb, char_length dell'errore, cardinalità degli allarmi), con un margine sui jsonb. */
export const LIMITI_RIGA = { finestreByte: 19_000, avvisiByte: 19_000, risposteByte: 1_900, errore: 500, allarmi: 20, testo: 200 } as const;
const MAX_INT = 2_147_483_647;

export type RigaEsecuzione = {
  id: string;
  fonte: FonteEsecuzione;
  modo: ModoEsecuzione;
  iniziato_il: string;
  finito_il: string;
  esito: EsitoEsecuzione;
  finestre: Record<string, unknown> | unknown[];
  fonte_richieste: number;
  fonte_byte: number;
  fonte_ms: number;
  fonte_risposte: Record<string, number>;
  db_richieste: number;
  db_ms: number;
  avvisi: Record<string, unknown>;
  gare_nuove: number;
  gare_unite: number;
  gare_aggiornate: number;
  rettifiche: number;
  conflitti: number;
  allarmi: string[];
  errore: string | null;
};

/** Che cosa ha fatto il giro, prima della normalizzazione. null = giro da NON registrare (ambiente non consentito, tabelle assenti). */
export type DatiGiro = {
  modo: Exclude<ModoEsecuzione, "manuale">;
  esito: EsitoEsecuzione;
  errore?: string | null;
  finestre?: Record<string, unknown>;
  misureFonte?: { richieste?: number; byte?: number; ms?: number; risposte?: Record<string, number> };
  db?: { richieste?: number; ms?: number };
  avvisi?: Record<string, unknown>;
  gare?: { nuove?: number; unite?: number; aggiornate?: number; rettifiche?: number; conflitti?: number };
  allarmi?: string[];
};

// ───────────────────────── normalizzazione ─────────────────────────

const intero = (n: unknown, massimo = MAX_INT): number => {
  const x = typeof n === "number" ? n : Number(n);
  return Number.isFinite(x) && x > 0 ? Math.min(Math.round(x), massimo) : 0;
};

/** Testo sicuro per Postgres e jsonb: niente NUL né surrogati spaiati (PostgREST li rifiuterebbe), al più `max` caratteri veri. */
export function testoSicuro(s: string, max: number): string {
  const pulito = s.replace(/\u0000/g, "").replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
  return Array.from(pulito).slice(0, max).join("");
}

/**
 * Valore JSON pulito: stringhe sicure e corte, niente undefined, profondità limitata, al più 200 voci per oggetto (le altre contate in
 * «__altre») e 100 elementi per elenco. Numeri finiti, arrotondati a 3 decimali ed entro 1e15: così il testo di JSON.stringify coincide con
 * quello del jsonb di Postgres (niente notazione esponenziale), e la misura dei byte resta esatta.
 */
function jsonPulito(v: unknown, profondita = 0): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return testoSicuro(v, LIMITI_RIGA.testo);
  if (typeof v === "number") return Number.isFinite(v) ? Math.max(-1e15, Math.min(1e15, Math.round(v * 1000) / 1000)) : null;
  if (typeof v === "boolean") return v;
  if (profondita >= 4) return null;
  if (Array.isArray(v)) return v.slice(0, 100).map((x) => jsonPulito(x, profondita + 1));
  if (typeof v === "object") {
    const o: Record<string, unknown> = {};
    const voci = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
    for (const [k, x] of voci.slice(0, 200)) {
      const chiave = testoSicuro(k, 80);
      if (chiave) o[chiave] = jsonPulito(x, profondita + 1);
    }
    if (voci.length > 200) o.__altre = voci.length - 200;
    return o;
  }
  return null;
}

/** Lunghezza in byte del testo che Postgres dà a un jsonb (spazio dopo «:» e «,»): è ciò che misura octet_length(x::text) nella 0128. */
export function byteJsonb(v: unknown): number {
  const enc = (x: unknown): string => {
    if (x === null || x === undefined) return "null";
    if (typeof x === "string" || typeof x === "number" || typeof x === "boolean") return JSON.stringify(x);
    if (Array.isArray(x)) return `[${x.map(enc).join(", ")}]`;
    return `{${Object.entries(x as Record<string, unknown>).map(([k, y]) => `${JSON.stringify(k)}: ${enc(y)}`).join(", ")}}`;
  };
  return new TextEncoder().encode(enc(v)).length;
}

/** Un oggetto entro il limite di byte: intero se ci sta, altrimenti solo i campi semplici (numeri, testi, vero/falso) più «troncato». */
export function oggettoEntro(v: unknown, limite: number): Record<string, unknown> {
  const o = jsonPulito(v);
  const oggetto = o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>) : {};
  if (byteJsonb(oggetto) <= limite) return oggetto;
  const semplici: Record<string, unknown> = { troncato: true };
  for (const [k, x] of Object.entries(oggetto)) if (x === null || typeof x !== "object") semplici[k] = x;
  return byteJsonb(semplici) <= limite ? semplici : { troncato: true };
}

/** Risposte per codice HTTP: solo conteggi interi, entro il limite. */
function risposteEntro(r: Record<string, number> | undefined): Record<string, number> {
  const o: Record<string, number> = {};
  for (const [k, n] of Object.entries(r ?? {})) {
    const chiave = testoSicuro(k, 20);
    if (chiave) o[chiave] = intero(n);
  }
  return byteJsonb(o) <= LIMITI_RIGA.risposteByte ? o : {};
}

/** Nomi degli allarmi come li vuole la 0128: [a-z_]{2,40}, senza doppioni, al più 20. */
export function allarmiValidi(a: readonly string[] | undefined): string[] {
  return [...new Set((a ?? []).filter((x) => /^[a-z_]{2,40}$/.test(x)))].slice(0, LIMITI_RIGA.allarmi);
}

/**
 * LA riga del registro: rispetta tutti i vincoli della 0128. In particolare il testo dell'errore c'è SOLO con l'esito «errore», ripulito
 * (mai indirizzi email, chiavi o token: erroreDaConservare) e lungo da 1 a 500 caratteri. Un giro lanciato dalla console vale «manuale».
 */
export function rigaEsecuzione(x: { id: string; fonte: FonteEsecuzione; origine: OrigineGiro; iniziato: Date; finito: Date } & DatiGiro): RigaEsecuzione {
  const finito = x.finito.getTime() < x.iniziato.getTime() ? x.iniziato : x.finito;
  const errore = x.esito === "errore" ? testoSicuro(erroreDaConservare(x.errore ?? ""), LIMITI_RIGA.errore).trim() || "errore senza descrizione" : null;
  return {
    id: x.id,
    fonte: x.fonte,
    modo: x.origine === "console" ? "manuale" : x.modo,
    iniziato_il: x.iniziato.toISOString(),
    finito_il: finito.toISOString(),
    esito: x.esito,
    finestre: oggettoEntro({ ...(x.finestre ?? {}), origine: x.origine }, LIMITI_RIGA.finestreByte),
    fonte_richieste: intero(x.misureFonte?.richieste),
    fonte_byte: intero(x.misureFonte?.byte, Number.MAX_SAFE_INTEGER),
    fonte_ms: intero(x.misureFonte?.ms),
    fonte_risposte: risposteEntro(x.misureFonte?.risposte),
    db_richieste: intero(x.db?.richieste),
    db_ms: intero(x.db?.ms),
    avvisi: oggettoEntro(x.avvisi ?? {}, LIMITI_RIGA.avvisiByte),
    gare_nuove: intero(x.gare?.nuove),
    gare_unite: intero(x.gare?.unite),
    gare_aggiornate: intero(x.gare?.aggiornate),
    rettifiche: intero(x.gare?.rettifiche),
    conflitti: intero(x.gare?.conflitti),
    allarmi: allarmiValidi(x.allarmi),
    errore,
  };
}

// ───────────────────────── dai risultati dei tre importatori ─────────────────────────

type UscitaAnticipata = { eseguita: false; motivo: "ambiente_non_consentito" | "fonte_spenta" | "occupata" | "gia_eseguito" | "schema_assente" | "errore_lettura"; dettaglio?: string };

/**
 * Le uscite prima del giro vero. MAI una riga se l'ambiente non è consentito (sarebbe una scrittura proprio dove non si deve scrivere) né
 * se le tabelle mancano. Fonte spenta = «inerte» (il cron è partito, la fonte no); blocco preso = «occupata»; lettura fallita = «errore».
 */
export function datiUscita(r: UscitaAnticipata, modo: DatiGiro["modo"]): DatiGiro | null {
  if (r.motivo === "ambiente_non_consentito" || r.motivo === "schema_assente") return null;
  if (r.motivo === "fonte_spenta") return { modo, esito: "inerte" };
  if (r.motivo === "occupata") return { modo, esito: "occupata" };
  // doppio richiamo di un giro programmato già riuscito (K1, 48C §3.1 punto 7): nessuna chiamata alla fonte
  if (r.motivo === "gia_eseguito") return { modo, esito: "gia_eseguito" };
  return { modo, esito: "errore", errore: `lettura dello stato della fonte non riuscita${r.dettaglio ? `: ${r.dettaglio}` : ""}` };
}

const esitoDi = (errore: string | null, sospesa: boolean): EsitoEsecuzione => (errore ? (sospesa ? "sospesa" : "errore") : "ok");
// la 0128 tiene il testo solo per «errore»: il motivo di una sospensione resta (ripulito e corto) tra gli avvisi, oltre che in conteggi
const motivoSospensione = (errore: string | null, sospesa: boolean) => (sospesa && errore ? { motivo_sospensione: testoSicuro(erroreDaConservare(errore), LIMITI_RIGA.testo) } : {});

export type RisultatoTedPerRegistro =
  | UscitaAnticipata
  | {
      eseguita: true;
      fase: "recupero" | "incrementale";
      giroFinito: boolean;
      fermata?: boolean;
      errore: string | null;
      totali: {
        pagine: number;
        bandi: { letti: number; esclusi: Record<string, number>; nuove: number; aggiornate: number; rettifiche: number; annullate: number; unitePvl: number; invariati: number };
        esiti: { letti: number; applicati: number; senzaBando: number };
        ted: { richieste: number; byte: number; ms: number };
        db: { richiesteDb: number; msDb: number };
      };
      cursore: { tipo?: string; da?: string; a?: string; ultimoGiorno?: string | null };
    };

export function datiGiroTed(r: RisultatoTedPerRegistro): DatiGiro | null {
  if (!r.eseguita) return datiUscita(r, "incrementale");
  const t = r.totali;
  return {
    modo: r.fase === "recupero" ? "recupero" : "incrementale",
    esito: esitoDi(r.errore, false),
    errore: r.errore,
    finestre: { fase: r.fase, tipo: r.cursore.tipo ?? null, da: r.cursore.da ?? null, a: r.cursore.a ?? null, ultimo_giorno: r.cursore.ultimoGiorno ?? null, pagine: t.pagine, giro_finito: r.giroFinito },
    misureFonte: { richieste: t.ted.richieste, byte: t.ted.byte, ms: t.ted.ms },
    db: { richieste: t.db.richiesteDb, ms: t.db.msDb },
    avvisi: { bandi: { letti: t.bandi.letti, invariati: t.bandi.invariati, annullati: t.bandi.annullate, esclusi: t.bandi.esclusi }, esiti: { letti: t.esiti.letti, applicati: t.esiti.applicati, senza_bando: t.esiti.senzaBando } },
    gare: { nuove: t.bandi.nuove, unite: t.bandi.unitePvl, aggiornate: t.bandi.aggiornate, rettifiche: t.bandi.rettifiche, conflitti: 0 },
    // K7: fonte spenta dalla console a metà giro → esito «ok» più l'allarme (48C §3.6)
    allarmi: r.fermata ? ["fermata_dalla_console"] : [],
  };
}

export type RisultatoPvlPerRegistro =
  | UscitaAnticipata
  | {
      eseguita: true;
      modo: "finestra" | "incrementale";
      giroFinito: boolean;
      sospesa: boolean;
      fermata?: boolean;
      errore: string | null;
      statistiche: {
        pvl: { richieste: number; byte: number; ms: number; risposte: Record<string, number>; conteggioDichiarato: number | null };
        avvisi: { letti: number; perScheda: Record<string, number>; bandi: number; esiti: number; esclusi: Record<string, number>; sostituiti: Record<string, number>; nonAttivi: number };
        bandi: { invariati: number; nuoveNazionali: number; nuoveSopraSogliaSenzaTed: number; giaPresentiTed: number; nuoveVersioni: number; aggiornate: number; rettifiche: number; annullate: number; conflitti: number };
        esiti: { letti: number; applicati: number; senzaGara: number };
        db: { richiesteDb: number; msDb: number };
      };
      // cursore v1 (da, a, pagine) o v2 (K4: la finestra del giro è in «letta»)
      cursore: { da?: string; a?: string; pagine?: number; ultimoGiorno?: string | null };
      letta?: { da: string; a: string; pagine: number } | null;
      // K4: recupero dei 90 giorni e dei buchi in questo giro; allarmi del cursore (buco_in_recupero, blocco_incompleto)
      recupero?: { richieste: number; blocchi: { da: string; a: string; esito: string; letti: number; dichiarati: number | null }[]; giorniBuchi: number; giorniObiettivo: number; fermo: boolean };
      allarmi?: string[];
    };

export function datiGiroPvl(r: RisultatoPvlPerRegistro): DatiGiro | null {
  if (!r.eseguita) return datiUscita(r, "incrementale");
  const s = r.statistiche;
  const l = r.letta !== undefined ? r.letta : r.cursore.da && r.cursore.a ? { da: r.cursore.da, a: r.cursore.a, pagine: r.cursore.pagine ?? 0 } : null;
  const rec = r.recupero;
  return {
    modo: r.modo === "finestra" ? "finestra" : "incrementale",
    esito: esitoDi(r.errore, r.sospesa),
    errore: r.errore,
    finestre: {
      modo: r.modo,
      da: l?.da ?? null,
      a: l?.a ?? null,
      pagine: l?.pagine ?? 0,
      dichiarati: s.pvl.conteggioDichiarato,
      letti: s.avvisi.letti,
      ultimo_giorno: r.cursore.ultimoGiorno ?? null,
      giro_finito: r.giroFinito,
      ...(rec ? { recupero: { richieste: rec.richieste, blocchi: rec.blocchi.slice(0, 10), giorni_buchi: rec.giorniBuchi, giorni_obiettivo: rec.giorniObiettivo, fermo: rec.fermo } } : {}),
    },
    misureFonte: { richieste: s.pvl.richieste, byte: s.pvl.byte, ms: s.pvl.ms, risposte: s.pvl.risposte },
    db: { richieste: s.db.richiesteDb, ms: s.db.msDb },
    avvisi: {
      letti: s.avvisi.letti,
      bandi: s.avvisi.bandi,
      esiti: s.avvisi.esiti,
      non_attivi: s.avvisi.nonAttivi,
      per_scheda: s.avvisi.perScheda,
      esclusi: s.avvisi.esclusi,
      sostituiti: s.avvisi.sostituiti,
      invariati: s.bandi.invariati,
      nuove_versioni: s.bandi.nuoveVersioni,
      annullati: s.bandi.annullate,
      esiti_applicati: s.esiti.applicati,
      esiti_senza_gara: s.esiti.senzaGara,
      ...motivoSospensione(r.errore, r.sospesa),
    },
    gare: { nuove: s.bandi.nuoveNazionali + s.bandi.nuoveSopraSogliaSenzaTed, unite: s.bandi.giaPresentiTed, aggiornate: s.bandi.aggiornate, rettifiche: s.bandi.rettifiche, conflitti: s.bandi.conflitti },
    // K7: fonte spenta dalla console a metà giro → esito «ok» più l'allarme (48C §3.6)
    allarmi: [...(r.sospesa ? ["sospesa"] : []), ...(r.fermata ? ["fermata_dalla_console"] : []), ...(r.allarmi ?? [])],
  };
}

export type RisultatoRegionalePerRegistro =
  | UscitaAnticipata
  | {
      eseguita: true;
      invariataAllaFonte: boolean;
      sospesa: boolean;
      errore: string | null;
      statistiche: {
        letti: number;
        esclusi: Record<string, number>;
        invariati: number;
        nuove: number;
        aggiornate: number;
        suGaraEsistente: Record<string, number>;
        rettifiche: number;
        annullate: number;
        conflitti: number;
        proposte: number;
        ambiguita: number;
        fonte: { richieste: number; byte: number; ms: number };
        db: { richiesteDb: number; msDb: number };
      };
    };

export function datiGiroRegionale(r: RisultatoRegionalePerRegistro): DatiGiro | null {
  if (!r.eseguita) return datiUscita(r, "incrementale");
  const s = r.statistiche;
  // «unite»: gare già nell'archivio da un'ALTRA fonte (per CIG o piattaforma); «procedura» = la stessa gara della stessa fonte
  const unite = Object.entries(s.suGaraEsistente).reduce((n, [via, k]) => (via === "procedura" ? n : n + k), 0);
  return {
    modo: "incrementale",
    esito: esitoDi(r.errore, r.sospesa),
    errore: r.errore,
    finestre: { invariata_alla_fonte: r.invariataAllaFonte },
    misureFonte: { richieste: s.fonte.richieste, byte: s.fonte.byte, ms: s.fonte.ms },
    db: { richieste: s.db.richiesteDb, ms: s.db.msDb },
    avvisi: { letti: s.letti, invariati: s.invariati, annullati: s.annullate, esclusi: s.esclusi, su_gara_esistente: s.suGaraEsistente, proposte: s.proposte, ambiguita: s.ambiguita, ...motivoSospensione(r.errore, r.sospesa) },
    gare: { nuove: s.nuove, unite, aggiornate: s.aggiornate, rettifiche: s.rettifiche, conflitti: s.conflitti },
    allarmi: r.sospesa ? ["sospesa"] : [],
  };
}
