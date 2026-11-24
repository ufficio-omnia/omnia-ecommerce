// Coda dei lavori di Tender Intelligence (importazioni, sintesi, analisi dei requisiti): regole pure, provate senza database.
//
//   - un lavoro ha una chiave di idempotenza unica: accodarlo due volte non crea un doppione;
//   - un solo esecutore per lavoro: chi lo prende lo blocca per un tempo limitato; se l'esecutore muore (funzione interrotta), allo scadere
//     del blocco il lavoro torna disponibile e il tentativo conta;
//   - dopo un errore si riprova con attese crescenti (1, 2, 4, 8… minuti, al massimo 60), fino al numero massimo di tentativi; poi «fallito».

export const STATI_LAVORO = ["in_coda", "in_corso", "completato", "fallito", "annullato"] as const;
export type StatoLavoro = (typeof STATI_LAVORO)[number];

export const MINUTI_BLOCCO = 15;
export const MINUTI_ATTESA_MASSIMA = 60;

export type LavoroRiga = {
  id: string;
  stato: StatoLavoro;
  tentativi: number;
  max_tentativi: number;
  prossimo_tentativo_il: string;
  bloccato_fino_a: string | null;
};

export function attesaDopoErrore(tentativi: number): number {
  const n = Math.max(1, Math.floor(tentativi));
  return Math.min(MINUTI_ATTESA_MASSIMA, 2 ** (n - 1)) * 60_000;
}

// Si può prendere ora? In coda e arrivato il suo turno, oppure «in corso» con il blocco scaduto (esecutore interrotto).
export function prendibile(l: LavoroRiga, adesso: Date): boolean {
  const ora = adesso.getTime();
  if (l.stato === "in_coda") return new Date(l.prossimo_tentativo_il).getTime() <= ora;
  if (l.stato === "in_corso") return l.bloccato_fino_a !== null && new Date(l.bloccato_fino_a).getTime() <= ora && l.tentativi < l.max_tentativi;
  return false;
}

export type EsitoErrore = { stato: "in_coda" | "fallito"; prossimo_tentativo_il: string };

export function dopoErrore(l: Pick<LavoroRiga, "tentativi" | "max_tentativi">, adesso: Date): EsitoErrore {
  if (l.tentativi >= l.max_tentativi) return { stato: "fallito", prossimo_tentativo_il: adesso.toISOString() };
  return { stato: "in_coda", prossimo_tentativo_il: new Date(adesso.getTime() + attesaDopoErrore(l.tentativi)).toISOString() };
}

export function bloccoFinoA(adesso: Date): string {
  return new Date(adesso.getTime() + MINUTI_BLOCCO * 60_000).toISOString();
}

// Messaggio d'errore conservato: breve e senza dati sensibili evidenti (indirizzi email, chiavi tipo «sk-…», «sb_secret_…», token lunghi).
export function erroreDaConservare(e: unknown): string {
  const testo = e instanceof Error ? e.message : String(e);
  return testo
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\b(sk|sb_secret|sb_publishable|rk)[-_][A-Za-z0-9_-]{8,}/g, "[chiave]")
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "[token]")
    .slice(0, 500);
}
