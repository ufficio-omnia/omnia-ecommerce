import type { Periodo } from "./periodo";

// Calcoli puri (nessun database) dei crediti OMNIA AI: venduti, consumati, residui.
//
// MODELLO. Un credito è una gara extra acquistata una tantum (pacchetto «singola»
// o «pacchetto5»). Si consuma quando una gara viene analizzata e il piano non ha
// più gare incluse (gara_consumi con tipo «credito»). Il saldo è in credits.balance.
// Alla cessazione dell'abbonamento il saldo residuo si azzera (clausola 5/8 delle
// condizioni): i crediti NON si perdono in un registro, quindi quelli «estinti»
// non sono tracciati e si DERIVANO per differenza:
//
//    estinti = venduti totali − consumati totali − saldo attuale
//
// Se la differenza è negativa il saldo supera ciò che risulta venduto meno
// consumato: crediti aggiunti o corretti a mano, che il registro non conosce.
// Si mostra come tale, non come un errore nascosto.

export type AcquistoCredito = {
  user_id: string;
  crediti: number;
  importo_centesimi: number;
  created_at: string;
  // acquisto con sessione Stripe di prova ("cs_test_")
  prova: boolean;
};

export type ConsumoCredito = { user_id: string; created_at: string };
export type SaldoCredito = { user_id: string; balance: number };

export type RigaCrediti = {
  userId: string;
  email: string | null;
  ragioneSociale: string | null;
  // nel periodo
  acquistatiPeriodo: number;
  importoPeriodo: number;
  consumatiPeriodo: number;
  // in tutto lo storico
  vendutiTotali: number;
  consumatiTotali: number;
  saldo: number;
  // derivato: venduti − consumati − saldo, se non negativo
  estinti: number;
  // crediti nel saldo che il registro non spiega (saldo > venduti − consumati)
  rettificheManuali: number;
  // tutti i suoi acquisti sono di prova
  prova: boolean;
};

export type TotaliCrediti = {
  acquistatiPeriodo: number;
  importoPeriodo: number;
  consumatiPeriodo: number;
  saldoResiduo: number;
  vendutiTotali: number;
  consumatiTotali: number;
  estinti: number;
  rettificheManuali: number;
  clienti: number;
};

export type ResultatoCrediti = {
  righe: RigaCrediti[];
  totali: TotaliCrediti;
  // clienti di prova nascosti (tutti gli acquisti con Stripe in test)
  provaNascosti: number;
};

export function calcolaCrediti(
  dati: {
    acquisti: AcquistoCredito[];
    consumi: ConsumoCredito[];
    saldi: SaldoCredito[];
    identita: Map<string, { email: string | null; ragioneSociale: string | null }>;
  },
  periodo: Periodo,
  includiProva: boolean,
): ResultatoCrediti {
  const nelPeriodo = (iso: string) => iso >= periodo.daIso && iso < periodo.aIso;
  const righe = new Map<string, RigaCrediti>();
  const acquistiPerUtente = new Map<string, AcquistoCredito[]>();

  const riga = (userId: string): RigaCrediti => {
    let r = righe.get(userId);
    if (!r) {
      const chi = dati.identita.get(userId);
      r = {
        userId, email: chi?.email ?? null, ragioneSociale: chi?.ragioneSociale ?? null,
        acquistatiPeriodo: 0, importoPeriodo: 0, consumatiPeriodo: 0,
        vendutiTotali: 0, consumatiTotali: 0, saldo: 0, estinti: 0, rettificheManuali: 0, prova: false,
      };
      righe.set(userId, r);
    }
    return r;
  };

  for (const a of dati.acquisti) {
    acquistiPerUtente.set(a.user_id, [...(acquistiPerUtente.get(a.user_id) ?? []), a]);
    const r = riga(a.user_id);
    r.vendutiTotali += a.crediti;
    if (nelPeriodo(a.created_at)) {
      r.acquistatiPeriodo += a.crediti;
      r.importoPeriodo += a.importo_centesimi / 100;
    }
  }
  for (const c of dati.consumi) {
    const r = riga(c.user_id);
    r.consumatiTotali++;
    if (nelPeriodo(c.created_at)) r.consumatiPeriodo++;
  }
  for (const s of dati.saldi) {
    // un utente con saldo zero e nessuna attività non è un cliente di crediti
    if (s.balance !== 0 || righe.has(s.user_id)) riga(s.user_id).saldo = s.balance;
  }

  for (const [userId, r] of righe) {
    const mioi = acquistiPerUtente.get(userId) ?? [];
    r.prova = mioi.length > 0 && mioi.every((a) => a.prova);
    const differenza = r.vendutiTotali - r.consumatiTotali - r.saldo;
    r.estinti = Math.max(0, differenza);
    r.rettificheManuali = Math.max(0, -differenza);
  }

  const tutte = [...righe.values()];
  const visibili = tutte.filter((r) => includiProva || !r.prova);

  const somma = (campo: (r: RigaCrediti) => number) => visibili.reduce((s, r) => s + campo(r), 0);
  return {
    righe: visibili,
    provaNascosti: tutte.length - visibili.length,
    totali: {
      acquistatiPeriodo: somma((r) => r.acquistatiPeriodo),
      importoPeriodo: somma((r) => r.importoPeriodo),
      consumatiPeriodo: somma((r) => r.consumatiPeriodo),
      saldoResiduo: somma((r) => r.saldo),
      vendutiTotali: somma((r) => r.vendutiTotali),
      consumatiTotali: somma((r) => r.consumatiTotali),
      estinti: somma((r) => r.estinti),
      rettificheManuali: somma((r) => r.rettificheManuali),
      clienti: visibili.length,
    },
  };
}

export type OrdineCrediti = "movimento" | "saldo" | "cliente";

export function leggiOrdineCrediti(valore: string | undefined): OrdineCrediti {
  return valore === "saldo" || valore === "cliente" ? valore : "movimento";
}

// movimento: più acquisti + consumi nel periodo per primi; saldo: saldo più alto; cliente: alfabetico.
export function ordinaCrediti(righe: RigaCrediti[], ordine: OrdineCrediti): RigaCrediti[] {
  const confronta = (a: RigaCrediti, b: RigaCrediti): number => {
    if (ordine === "saldo") return b.saldo - a.saldo || a.userId.localeCompare(b.userId);
    if (ordine === "cliente") return (a.email ?? "￿").localeCompare(b.email ?? "￿", "it");
    return b.acquistatiPeriodo + b.consumatiPeriodo - (a.acquistatiPeriodo + a.consumatiPeriodo) || b.saldo - a.saldo;
  };
  return [...righe].sort(confronta);
}
