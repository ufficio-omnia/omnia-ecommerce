// Costo dei modelli per GARA di un cliente (pagina Costi e margini, scheda del cliente). Funzioni PURE: nessun database,
// nessun modello. La lettura dei dati sta in costi.ts; i test in scripts/verifica-console-costi-per-gara.ts.
//
// Da dove viene il dato: ogni chiamata a un modello è una riga di ai_operazioni (cliente, gara, operazione, costo in dollari).
// Per l'Ufficio Gare le operazioni sono registrate sul titolare (vedi project_ufficio_gare), quindi qui compaiono sotto il
// cliente che paga. Una gara cancellata perde il legame (gara_id nullo): il suo costo finisce nella riga «senza gara».

export type OperazioneGrezza = { gara_id: string | null; operazione: string; costo_stimato: number | null; created_at: string };
export type GaraInfo = { id: string; titolo: string | null; created_at: string };
export type ConsumoGara = { gara_id: string | null; tipo: string; created_at: string };

export type TipoConsumo = "piano" | "credito" | "gratuita" | "altro";

export type RigaGara = {
  // nullo = costi non legati a una gara (gare cancellate, assistente di supporto)
  garaId: string | null;
  titolo: string;
  creataIl: string | null;
  // come è stata pagata la gara (una sola volta, alla prima analisi); null = nessun consumo registrato
  consumo: TipoConsumo | null;
  operazioniPeriodo: number;
  senzaCostoPeriodo: number;
  costoPeriodoUsd: number;
  operazioniTotali: number;
  senzaCostoTotali: number;
  costoTotaleUsd: number;
  primaAttivita: string | null;
  ultimaAttivita: string | null;
};

export type CostiPerGara = {
  righe: RigaGara[];
  totalePeriodoUsd: number;
  totaleUsd: number;
};

export const TITOLO_SENZA_GARA = "Costi non legati a una gara (gare cancellate, assistente di supporto)";
export const TITOLO_GARA_CANCELLATA = "(gara senza titolo)";

// Le operazioni di prova dei test con il modello vero non sono costi dei clienti: la stessa regola delle funzioni SQL della
// console (migrazione 0077, console_costi_per_operazione).
export function eOperazioneDiProva(operazione: string): boolean {
  return operazione.startsWith("prova:") || operazione.startsWith("prova-leggero:");
}

function tipoConsumo(tipo: string): TipoConsumo {
  return tipo === "piano" || tipo === "credito" || tipo === "gratuita" ? tipo : "altro";
}

const numero = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Aggrega le operazioni di UN cliente per gara. `daIso`/`aIso` delimitano il periodo (inizio compreso, fine esclusa, come le
// funzioni SQL). Il costo TOTALE è «dall'inizio» (tutte le operazioni del cliente su quella gara); quello del periodo conta solo
// le operazioni nell'intervallo. Una gara compare se ha almeno un'operazione, anche fuori dal periodo (costo del periodo zero).
// Ordine: più costosa nel periodo, poi più costosa in totale; la riga «senza gara» sta sempre in fondo.
export function aggregaCostiPerGara(
  operazioni: OperazioneGrezza[],
  gare: GaraInfo[],
  consumi: ConsumoGara[],
  periodo: { daIso: string; aIso: string },
): CostiPerGara {
  const da = new Date(periodo.daIso).getTime();
  const a = new Date(periodo.aIso).getTime();
  const gareInfo = new Map(gare.map((g) => [g.id, g]));
  const consumoPerGara = new Map<string, { tipo: TipoConsumo; creato: number }>();
  for (const c of consumi) {
    if (!c.gara_id) continue;
    const creato = new Date(c.created_at).getTime();
    const attuale = consumoPerGara.get(c.gara_id);
    if (!attuale || creato < attuale.creato) consumoPerGara.set(c.gara_id, { tipo: tipoConsumo(c.tipo), creato });
  }

  const righe = new Map<string, RigaGara>();
  const SENZA_GARA = "\u0000senza-gara";
  for (const o of operazioni) {
    if (eOperazioneDiProva(o.operazione)) continue;
    const chiave = o.gara_id ?? SENZA_GARA;
    let r = righe.get(chiave);
    if (!r) {
      const info = o.gara_id ? gareInfo.get(o.gara_id) : undefined;
      r = {
        garaId: o.gara_id,
        titolo: o.gara_id ? (info?.titolo?.trim() || TITOLO_GARA_CANCELLATA) : TITOLO_SENZA_GARA,
        creataIl: info?.created_at ?? null,
        consumo: o.gara_id ? (consumoPerGara.get(o.gara_id)?.tipo ?? null) : null,
        operazioniPeriodo: 0,
        senzaCostoPeriodo: 0,
        costoPeriodoUsd: 0,
        operazioniTotali: 0,
        senzaCostoTotali: 0,
        costoTotaleUsd: 0,
        primaAttivita: null,
        ultimaAttivita: null,
      };
      righe.set(chiave, r);
    }
    const costo = o.costo_stimato === null ? null : numero(o.costo_stimato);
    const quando = new Date(o.created_at).getTime();
    r.operazioniTotali++;
    if (costo === null) r.senzaCostoTotali++;
    else r.costoTotaleUsd += costo;
    if (quando >= da && quando < a) {
      r.operazioniPeriodo++;
      if (costo === null) r.senzaCostoPeriodo++;
      else r.costoPeriodoUsd += costo;
    }
    if (r.primaAttivita === null || o.created_at < r.primaAttivita) r.primaAttivita = o.created_at;
    if (r.ultimaAttivita === null || o.created_at > r.ultimaAttivita) r.ultimaAttivita = o.created_at;
  }

  const elenco = [...righe.values()].sort((x, y) => {
    if ((x.garaId === null) !== (y.garaId === null)) return x.garaId === null ? 1 : -1;
    return y.costoPeriodoUsd - x.costoPeriodoUsd || y.costoTotaleUsd - x.costoTotaleUsd || (y.ultimaAttivita ?? "").localeCompare(x.ultimaAttivita ?? "");
  });
  return {
    righe: elenco,
    totalePeriodoUsd: elenco.reduce((s, r) => s + r.costoPeriodoUsd, 0),
    totaleUsd: elenco.reduce((s, r) => s + r.costoTotaleUsd, 0),
  };
}

// Il totale per gara deve coincidere con il «Costo dei modelli» del periodo (stesso insieme di operazioni, stesse esclusioni):
// se non quadra (tolleranza di un centesimo di dollaro) la pagina lo dice invece di mostrare due numeri diversi senza spiegare.
export function quadraConIlTotale(totalePerGaraUsd: number, totaleCostiUsd: number): boolean {
  return Math.abs(totalePerGaraUsd - totaleCostiUsd) <= 0.01;
}

export function etichettaConsumo(consumo: TipoConsumo | null): string {
  if (consumo === "piano") return "piano";
  if (consumo === "credito") return "crediti";
  if (consumo === "gratuita") return "gara gratuita";
  if (consumo === "altro") return "altro";
  return "nessun consumo registrato";
}
