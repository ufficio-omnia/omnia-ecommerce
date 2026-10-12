import { normalizzaPianoSlug, PIANI } from "@/lib/omnia-ai-plans";
import { dataRoma } from "./giorni-lavorativi";
import { aggiungiGiorni, giorniTra, type Periodo } from "./periodo";

// Calcoli puri (nessun database) di costo, ricavo e margine per cliente.
// Separati dalla lettura dei dati per poterli provare con un autotest: sono
// il numero su cui si decide, e un errore qui non si vedrebbe a occhio.
//
// Come si calcola, in chiaro (lo stesso testo compare nella pagina):
//  - COSTO: somma di ai_operazioni.costo_stimato (dollari) nel periodo, esclusi
//    i test degli script; in euro col cambio impostato nella console.
//  - RICAVO: abbonamento DA LISTINO (prezzo del piano ÷ 30,4375 × i giorni del
//    periodo in cui l'abbonamento era attivo; i giorni non ancora trascorsi non
//    contano) più i crediti acquistati nel periodo (importo realmente pagato).
//    Dal Blocco 4 l'abbonamento passa agli incassi reali di Stripe.
//  - MARGINE: ricavo senza IVA meno costo in euro.

// Giorni di un mese medio: 365,25 / 12.
export const GIORNI_MESE_MEDIO = 30.4375;

export type AbbonamentoRiga = {
  plan: string;
  status: string;
  stripe_subscription_id: string | null;
  created_at: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
};

export type RicavoAbbonamento = {
  // lordo IVA
  importo: number;
  giorni: number;
  // riga creata a mano dall'admin (nessun abbonamento Stripe): non genera ricavo
  manuale: boolean;
  // piano non riconosciuto tra quelli del catalogo: non si può prezzare
  pianoSconosciuto: boolean;
};

// Primo giorno (AAAA-MM-GG) in cui l'abbonamento NON è più attivo, o null se è
// ancora in corso: un abbonamento attivo e senza disdetta continua; altrimenti
// dura fino a current_period_end (il giorno stesso non conta: il rinnovo
// sarebbe cominciato quel giorno).
function fineAbbonamento(abb: AbbonamentoRiga): string | null {
  const aperto = abb.status === "attivo" && !abb.cancel_at_period_end;
  if (aperto) return null;
  return abb.current_period_end ? dataRoma(new Date(abb.current_period_end)) : dataRoma(new Date(abb.created_at));
}

// Tratto di calendario [da, a) in cui una riga di abbonamento genera ricavo nel
// periodo, con il suo ricavo giornaliero (lordo). null se la riga non genera
// ricavo (creata a mano, piano fuori catalogo) o non tocca il periodo.
type Tratto = { da: string; a: string; giornaliero: number };

function trattoAbbonamento(abb: AbbonamentoRiga, periodo: Periodo, oggi: string): Tratto | null {
  const piano = normalizzaPianoSlug(abb.plan);
  if (!abb.stripe_subscription_id || !piano) return null;

  const inizio = dataRoma(new Date(abb.created_at));
  const fine = fineAbbonamento(abb);
  // i giorni non ancora trascorsi non generano ricavo (né costo): il periodo si taglia a domani
  const a = [aggiungiGiorni(periodo.a, 1), aggiungiGiorni(oggi, 1), fine].filter((g): g is string => g !== null).sort()[0];
  const da = [periodo.da, inizio].sort().reverse()[0];
  return da < a ? { da, a, giornaliero: PIANI[piano].prezzoCentesimi / 100 / GIORNI_MESE_MEDIO } : null;
}

// Ricavo da listino di TUTTE le righe di abbonamento di un utente nel periodo.
// Uno stesso utente può avere più righe che si sovrappongono (un abbonamento
// ricreato, una prova ripetuta, un cambio di piano): ogni giorno conta UNA volta,
// col piano più caro tra quelli attivi quel giorno. Sommare le righe una per una
// conterebbe due o tre volte lo stesso periodo (visto sui dati reali: 89 giorni
// di abbonamento in un periodo di 30).
export function ricavoAbbonamentiUtente(righe: AbbonamentoRiga[], periodo: Periodo, oggi: string): RicavoAbbonamento {
  const manuale = righe.length > 0 && righe.every((r) => !r.stripe_subscription_id);
  const pianoSconosciuto = righe.some((r) => r.stripe_subscription_id && !normalizzaPianoSlug(r.plan));

  const tratti = righe.map((r) => trattoAbbonamento(r, periodo, oggi)).filter((t): t is Tratto => t !== null);
  const confini = [...new Set(tratti.flatMap((t) => [t.da, t.a]))].sort();

  let importo = 0;
  let giorni = 0;
  for (let i = 0; i + 1 < confini.length; i++) {
    const [da, a] = [confini[i], confini[i + 1]];
    const attivi = tratti.filter((t) => t.da <= da && t.a >= a);
    if (attivi.length === 0) continue;
    const giorniTratto = giorniTra(da, a);
    importo += Math.max(...attivi.map((t) => t.giornaliero)) * giorniTratto;
    giorni += giorniTratto;
  }
  return { importo, giorni, manuale, pianoSconosciuto };
}

// Una riga sola (usata dai test e dalle verifiche puntuali).
export function ricavoAbbonamentoLordo(abb: AbbonamentoRiga, periodo: Periodo, oggi: string): RicavoAbbonamento {
  return ricavoAbbonamentiUtente([abb], periodo, oggi);
}

export function usdInEur(usd: number, cambio: number | null): number | null {
  return cambio === null ? null : usd * cambio;
}

export type Margine = { ricavoNetto: number; margine: number | null; percentuale: number | null };

export function calcolaMargine(ricavoLordo: number, costoEur: number | null, aliquotaIva: number): Margine {
  const ricavoNetto = ricavoLordo / (1 + aliquotaIva / 100);
  if (costoEur === null) return { ricavoNetto, margine: null, percentuale: null };
  const margine = ricavoNetto - costoEur;
  return { ricavoNetto, margine, percentuale: ricavoNetto > 0 ? margine / ricavoNetto : null };
}

// ───── Assemblaggio per cliente ─────

export type CostoClienteDb = {
  user_id: string | null;
  categoria: "cliente" | "piattaforma" | "non_attribuito" | "prova";
  operazioni: number;
  operazioni_senza_costo: number;
  costo_usd: number;
  input_token: number;
  output_token: number;
};

export type GareConsumateDb = { user_id: string; gare_piano: number; gare_credito: number };
export type AcquistoCredito = { user_id: string; importo_centesimi: number };
export type Identita = { email: string | null; ragioneSociale: string | null };

export type RigaCliente = {
  userId: string;
  email: string | null;
  ragioneSociale: string | null;
  // piano dell'abbonamento più recente (slug del catalogo, testo grezzo se sconosciuto)
  piano: string | null;
  abbonamentoManuale: boolean;
  costoUsd: number;
  costoEur: number | null;
  operazioni: number;
  operazioniSenzaCosto: number;
  gare: number;
  gareDaPiano: number;
  gareDaCredito: number;
  costoPerGaraEur: number | null;
  ricavoAbbonamentoLordo: number;
  ricavoCreditiLordo: number;
  ricavoLordo: number;
  ricavoNetto: number;
  margine: number | null;
  marginePerc: number | null;
  giorniAbbonamento: number;
};

export type TotaliCosti = {
  // costo dei CLIENTI più quello della piattaforma (knowledge base): è ciò che pesa sul margine
  costoUsd: number;
  costoEur: number | null;
  // di cui: costo della piattaforma (kb_*)
  costoPiattaformaUsd: number;
  // costo di operazioni senza cliente e senza essere della piattaforma: script di
  // sviluppo precedenti al prefisso "prova:" o clienti eliminati. NON entra nel
  // margine né nel costo per gara (è spesa di sviluppo, non costo di servire i
  // clienti), ma si mostra sempre: è denaro speso davvero.
  costoNonAttribuitoUsd: number;
  // chiamate di clienti e piattaforma
  operazioni: number;
  // chiamate senza tariffa, tra TUTTE quelle non di prova: serve a controllare le tariffe
  operazioniSenzaCosto: number;
  gare: number;
  // costo dei soli clienti ÷ gare consumate
  costoPerGaraEur: number | null;
  ricavoNetto: number;
  margine: number | null;
  marginePerc: number | null;
};

export type CostiNonAttribuiti = {
  categoria: "piattaforma" | "non_attribuito" | "prova";
  operazioni: number;
  operazioniSenzaCosto: number;
  costoUsd: number;
};

export type DatiGrezziCosti = {
  costi: CostoClienteDb[];
  gare: GareConsumateDb[];
  abbonamenti: (AbbonamentoRiga & { user_id: string })[];
  acquisti: AcquistoCredito[];
  identita: Map<string, Identita>;
};

export type ParametriDiCalcolo = { cambioUsdEur: number | null; aliquotaIva: number };

export function assemblaClienti(dati: DatiGrezziCosti, parametri: ParametriDiCalcolo, periodo: Periodo, adesso: Date) {
  const oggi = dataRoma(adesso);
  const clienti = new Map<string, RigaCliente>();

  const riga = (userId: string): RigaCliente => {
    let r = clienti.get(userId);
    if (!r) {
      const identita = dati.identita.get(userId);
      r = {
        userId,
        email: identita?.email ?? null,
        ragioneSociale: identita?.ragioneSociale ?? null,
        piano: null,
        abbonamentoManuale: false,
        costoUsd: 0,
        costoEur: null,
        operazioni: 0,
        operazioniSenzaCosto: 0,
        gare: 0,
        gareDaPiano: 0,
        gareDaCredito: 0,
        costoPerGaraEur: null,
        ricavoAbbonamentoLordo: 0,
        ricavoCreditiLordo: 0,
        ricavoLordo: 0,
        ricavoNetto: 0,
        margine: null,
        marginePerc: null,
        giorniAbbonamento: 0,
      };
      clienti.set(userId, r);
    }
    return r;
  };

  const nonAttribuiti: CostiNonAttribuiti[] = [];
  for (const c of dati.costi) {
    if (c.categoria === "cliente" && c.user_id) {
      const r = riga(c.user_id);
      r.costoUsd += c.costo_usd;
      r.operazioni += c.operazioni;
      r.operazioniSenzaCosto += c.operazioni_senza_costo;
    } else if (c.categoria !== "cliente") {
      nonAttribuiti.push({ categoria: c.categoria, operazioni: c.operazioni, operazioniSenzaCosto: c.operazioni_senza_costo, costoUsd: c.costo_usd });
    }
  }

  for (const g of dati.gare) {
    const r = riga(g.user_id);
    r.gareDaPiano += g.gare_piano;
    r.gareDaCredito += g.gare_credito;
    r.gare += g.gare_piano + g.gare_credito;
  }

  // piano: l'abbonamento più recente per data di creazione
  const piuRecente = new Map<string, AbbonamentoRiga & { user_id: string }>();
  for (const a of dati.abbonamenti) {
    const attuale = piuRecente.get(a.user_id);
    if (!attuale || a.created_at > attuale.created_at) piuRecente.set(a.user_id, a);
  }
  const abbonamentiPerUtente = new Map<string, (AbbonamentoRiga & { user_id: string })[]>();
  for (const a of dati.abbonamenti) abbonamentiPerUtente.set(a.user_id, [...(abbonamentiPerUtente.get(a.user_id) ?? []), a]);
  for (const [userId, righeUtente] of abbonamentiPerUtente) {
    const ricavo = ricavoAbbonamentiUtente(righeUtente, periodo, oggi);
    // un utente senza costi né gare nel periodo compare solo se ha un ricavo
    if (ricavo.importo > 0 || clienti.has(userId)) {
      const r = riga(userId);
      r.ricavoAbbonamentoLordo += ricavo.importo;
      r.giorniAbbonamento += ricavo.giorni;
    }
  }
  for (const [userId, a] of piuRecente) {
    const r = clienti.get(userId);
    if (r) {
      r.piano = normalizzaPianoSlug(a.plan) ?? a.plan;
      r.abbonamentoManuale = !a.stripe_subscription_id;
    }
  }

  for (const acquisto of dati.acquisti) {
    riga(acquisto.user_id).ricavoCreditiLordo += acquisto.importo_centesimi / 100;
  }

  const righe = [...clienti.values()];
  for (const r of righe) {
    r.costoEur = usdInEur(r.costoUsd, parametri.cambioUsdEur);
    r.costoPerGaraEur = r.costoEur !== null && r.gare > 0 ? r.costoEur / r.gare : null;
    r.ricavoLordo = r.ricavoAbbonamentoLordo + r.ricavoCreditiLordo;
    const m = calcolaMargine(r.ricavoLordo, r.costoEur, parametri.aliquotaIva);
    r.ricavoNetto = m.ricavoNetto;
    r.margine = m.margine;
    r.marginePerc = m.percentuale;
  }

  // Totali. Nel margine entrano i costi dei clienti e quelli della piattaforma
  // (knowledge base: serve per erogare il servizio). NON entrano le operazioni
  // senza cliente e senza essere della piattaforma (script di sviluppo, clienti
  // eliminati), che si mostrano a parte, né le prove degli script con prefisso.
  const costoClientiUsd = righe.reduce((s, r) => s + r.costoUsd, 0);
  const costoPiattaformaUsd = nonAttribuiti.filter((n) => n.categoria === "piattaforma").reduce((s, n) => s + n.costoUsd, 0);
  const costoNonAttribuitoUsd = nonAttribuiti.filter((n) => n.categoria === "non_attribuito").reduce((s, n) => s + n.costoUsd, 0);
  const costoUsd = costoClientiUsd + costoPiattaformaUsd;
  const costoEur = usdInEur(costoUsd, parametri.cambioUsdEur);
  const ricavoLordo = righe.reduce((s, r) => s + r.ricavoLordo, 0);
  const margineTotale = calcolaMargine(ricavoLordo, costoEur, parametri.aliquotaIva);
  const gare = righe.reduce((s, r) => s + r.gare, 0);
  const costoClientiEur = usdInEur(costoClientiUsd, parametri.cambioUsdEur);
  const nonDiProva = nonAttribuiti.filter((n) => n.categoria !== "prova");

  const totali: TotaliCosti = {
    costoUsd,
    costoEur,
    costoPiattaformaUsd,
    costoNonAttribuitoUsd,
    operazioni: righe.reduce((s, r) => s + r.operazioni, 0) + nonAttribuiti.filter((n) => n.categoria === "piattaforma").reduce((s, n) => s + n.operazioni, 0),
    operazioniSenzaCosto: righe.reduce((s, r) => s + r.operazioniSenzaCosto, 0) + nonDiProva.reduce((s, n) => s + n.operazioniSenzaCosto, 0),
    gare,
    costoPerGaraEur: costoClientiEur !== null && gare > 0 ? costoClientiEur / gare : null,
    ricavoNetto: margineTotale.ricavoNetto,
    margine: margineTotale.margine,
    marginePerc: margineTotale.percentuale,
  };

  return { righe, nonAttribuiti, totali };
}

// ───── Ordinamento ─────

export type OrdineCosti = "costo" | "margine" | "gare" | "cliente";

export function leggiOrdineCosti(valore: string | undefined): OrdineCosti {
  return valore === "margine" || valore === "gare" || valore === "cliente" ? valore : "costo";
}

// costo, gare: dal più alto; margine: dal più basso (i clienti in perdita per primi); cliente: alfabetico.
// Un valore assente (cambio non impostato) va sempre in fondo.
export function ordinaClienti(righe: RigaCliente[], ordine: OrdineCosti): RigaCliente[] {
  const confronta = (a: RigaCliente, b: RigaCliente): number => {
    switch (ordine) {
      case "margine": {
        if (a.margine === null || b.margine === null) return (a.margine === null ? 1 : 0) - (b.margine === null ? 1 : 0);
        return a.margine - b.margine;
      }
      case "gare":
        return b.gare - a.gare || b.costoUsd - a.costoUsd;
      case "cliente":
        // senza email in fondo
        return (a.email ?? "￿").localeCompare(b.email ?? "￿", "it");
      default:
        return b.costoUsd - a.costoUsd;
    }
  };
  return [...righe].sort(confronta);
}
