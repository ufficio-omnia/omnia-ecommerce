// Pagina «Fonti» della console (48C §3.5–3.6): testi e colori dello stato e degli allarmi, prossimo giro previsto, righe del registro dei giri
// per l'elenco. Logica pura, provata da scripts/verifica-monitorate-fonti-nascoste.ts (sezione S). Lo stato e gli allarmi li calcola B2
// (stato-fonti-calcoli.ts, K3): qui solo come si mostrano.
import type { FonteEsecuzione } from "@/lib/radar/esecuzioni-calcoli";
import { orariPrevisti } from "@/lib/radar/programmazione-calcoli";
import type { GravitaAllarme, RigaEsecuzioneLetta, StatoFonte } from "@/lib/radar/stato-fonti-calcoli";

export type TonoConsole = "neutro" | "ok" | "avviso" | "errore";

export const STATO_FONTE_CONSOLE: Record<StatoFonte, { testo: string; spiegazione: string; tono: TonoConsole }> = {
  ok: { testo: "In funzione", spiegazione: "l'ultimo esito non è un errore più recente dell'ultimo successo", tono: "ok" },
  in_errore: { testo: "In errore", spiegazione: "l'ultimo esito è un errore più recente dell'ultimo successo", tono: "errore" },
  sospesa: { testo: "Sospesa dal connettore", spiegazione: "fermata da un giro (motivo nel registro); si riaccende solo da qui", tono: "errore" },
  spenta: { testo: "Spenta", spiegazione: "spenta dalla console: nessun giro", tono: "neutro" },
};

export const GRAVITA_CONSOLE: Record<GravitaAllarme, { testo: string; tono: TonoConsole }> = {
  errore: { testo: "errore", tono: "errore" },
  avviso: { testo: "avviso", tono: "avviso" },
  informazione: { testo: "informazione", tono: "neutro" },
};

export const NOME_FONTE_CONSOLE: Record<FonteEsecuzione, string> = { ted: "TED", pvl: "PVL ANAC", sintel: "Sintel", sardegnacat: "SardegnaCAT" };

const MODO: Record<string, string> = { incrementale: "incrementale", recupero: "recupero", finestra: "finestra", manuale: "manuale (console)" };
const ESITO: Record<string, string> = { ok: "riuscito", errore: "errore", sospesa: "sospesa", occupata: "occupata (altro giro in corso)", inerte: "nulla da fare", gia_eseguito: "già eseguito" };

export function modoLeggibile(m: string): string {
  return MODO[m] ?? m;
}
export function esitoLeggibile(e: string): string {
  return ESITO[e] ?? e;
}

export const GIRI_PER_FONTE = 10;
const GIORNI_PROSSIMO_GIRO = 8;

/** Il prossimo giro previsto: solo per una fonte accesa con i giri programmati accesi in questo ambiente; altrimenti null. */
export function prossimoGiro(fonte: FonteEsecuzione, attiva: boolean, cronAttivo: boolean, adesso: Date): string | null {
  if (!attiva || !cronAttivo) return null;
  return orariPrevisti(fonte, adesso, new Date(adesso.getTime() + GIORNI_PROSSIMO_GIRO * 86_400_000))[0]?.toISOString() ?? null;
}

// Una riga del registro per l'elenco: solo conteggi, codici e l'errore ripulito del giro (nessun dato di gare)
export type GiroConsole = {
  modo: string;
  esito: string;
  iniziatoIl: string;
  durataMs: number | null;
  richiesteFonte: number;
  richiesteDb: number;
  gareNuove: number;
  allarmi: string[];
  errore: string | null;
};

export function giroConsole(r: RigaEsecuzioneLetta): GiroConsole {
  const durata = Date.parse(r.finito_il) - Date.parse(r.iniziato_il);
  return {
    modo: r.modo,
    esito: r.esito,
    iniziatoIl: r.iniziato_il,
    durataMs: Number.isFinite(durata) && durata >= 0 ? durata : null,
    richiesteFonte: r.fonte_richieste,
    richiesteDb: r.db_richieste,
    gareNuove: r.gare_nuove,
    allarmi: r.allarmi ?? [],
    errore: r.errore,
  };
}

/** Gli ultimi giri di ciascuna fonte (al più GIRI_PER_FONTE, dal più recente) da righe già lette in ordine decrescente. */
export function giriPerFonte(righe: readonly RigaEsecuzioneLetta[], fonte: string): GiroConsole[] {
  return righe
    .filter((r) => r.fonte === fonte)
    .sort((a, b) => Date.parse(b.iniziato_il) - Date.parse(a.iniziato_il))
    .slice(0, GIRI_PER_FONTE)
    .map(giroConsole);
}
