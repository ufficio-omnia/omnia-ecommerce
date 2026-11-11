import { dataRoma } from "./giorni-lavorativi";
import { aggiungiGiorni, type Periodo } from "./periodo";

// Calcoli puri (nessun database) dei ricavi per dominio e per mese.
//
// DUE DOMINI. "ecommerce" = ordini pagati di app.omniaitalia.com; "omnia_ai" =
// incassi degli abbonamenti (fatture Stripe pagate) più i crediti, le revisioni umane,
// i piani di lavoro e i pacchetti di servizi aggiuntivi acquistati. Ogni fonte ha il suo ramo
// esplicito in aggregaRicavi: una fonte senza ramo finirebbe tra gli abbonamenti.
//
// COMPETENZA = DATA DI INCASSO. Un ordine con carta vale dal giorno dell'ordine;
// un bonifico dal giorno in cui l'admin ha confermato l'accredito (orders.paid_at).
// Per i bonifici confermati prima della migrazione 0075 quella data non esiste e
// si usa la data dell'ordine, DICHIARANDO quanti sono (dataApprossimata).
//
// LORDO E NETTO. Tutti i prezzi sono IVA inclusa. Il netto si ricava dall'imposta
// calcolata da Stripe quando c'è; altrimenti si scorpora con l'aliquota dei
// parametri della console (ivaStimata).
//
// DATI DI PROVA. L'account Stripe di OMNIA AI è in modalità test: i suoi incassi
// (livemode=false) e gli acquisti di crediti con sessione "cs_test_" non sono
// denaro. Escono dai totali, tranne che su richiesta esplicita, e si dichiara
// sempre quanto è stato escluso.

export type DominioRicavo = "ecommerce" | "omnia_ai";
export type FonteRicavo = "ordine" | "abbonamento" | "crediti" | "revisione" | "piano_lavoro" | "pacchetto" | "copertina";

export type VoceRicavo = {
  dominio: DominioRicavo;
  fonte: FonteRicavo;
  // istante di competenza (ISO)
  data: string;
  // euro, IVA inclusa
  lordo: number;
  // euro, calcolata da Stripe; null se non disponibile
  impostaStripe: number | null;
  prova: boolean;
  dataApprossimata: boolean;
};

export function nettoVoce(voce: VoceRicavo, aliquotaIva: number): { netto: number; stimato: boolean } {
  if (voce.impostaStripe !== null && voce.impostaStripe > 0) return { netto: voce.lordo - voce.impostaStripe, stimato: false };
  return { netto: voce.lordo / (1 + aliquotaIva / 100), stimato: true };
}

export type MeseRicavi = {
  // AAAA-MM
  mese: string;
  ecommerce: number;
  abbonamenti: number;
  crediti: number;
  // revisioni umane delle relazioni tecniche (servizio con consulente)
  revisioni: number;
  // acquisti singoli del piano di lavoro di una gara
  pianiLavoro: number;
  // pacchetti prepagati di servizi aggiuntivi (piani di lavoro...): contano come ricavo quando si pagano, non quando si usano
  pacchetti: number;
  // acquisti della copertina della relazione tecnica di una gara
  copertine: number;
  totale: number;
};

export type TotaliRicavi = {
  lordo: number;
  netto: number;
  ecommerceLordo: number;
  ecommerceNetto: number;
  ecommerceOrdini: number;
  omniaAiLordo: number;
  omniaAiNetto: number;
  abbonamentiNetto: number;
  creditiNetto: number;
  revisioniNetto: number;
  pianiLavoroNetto: number;
  pacchettiNetto: number;
  copertineNetto: number;
  incassiAbbonamento: number;
  acquistiCrediti: number;
  acquistiRevisione: number;
  acquistiPianoLavoro: number;
  acquistiPacchetto: number;
  acquistiCopertina: number;
};

export type RiepilogoRicavi = {
  totali: TotaliRicavi;
  perMese: MeseRicavi[];
  // voci di prova: se non incluse sono ESCLUSE dai totali, se incluse sono dentro; il conto è comunque questo
  prova: { voci: number; lordo: number; incluse: boolean };
  // ordini con bonifico confermato prima della 0075: data di pagamento = data dell'ordine
  dateApprossimate: number;
  // almeno una voce ha il netto scorporato con l'aliquota invece che dall'imposta di Stripe
  ivaStimata: boolean;
};

function mesiDelPeriodo(periodo: Periodo): string[] {
  const mesi: string[] = [];
  let corrente = `${periodo.da.slice(0, 7)}-01`;
  while (corrente.slice(0, 7) <= periodo.a.slice(0, 7)) {
    mesi.push(corrente.slice(0, 7));
    // primo giorno del mese successivo
    const [anno, mese] = corrente.split("-").map(Number);
    corrente = new Date(Date.UTC(anno, mese, 1)).toISOString().slice(0, 10);
  }
  return mesi;
}

export function aggregaRicavi(voci: VoceRicavo[], periodo: Periodo, aliquotaIva: number, includiProva: boolean): RiepilogoRicavi {
  const mesi = new Map<string, MeseRicavi>(mesiDelPeriodo(periodo).map((m) => [m, { mese: m, ecommerce: 0, abbonamenti: 0, crediti: 0, revisioni: 0, pianiLavoro: 0, pacchetti: 0, copertine: 0, totale: 0 }]));
  const totali: TotaliRicavi = {
    lordo: 0, netto: 0, ecommerceLordo: 0, ecommerceNetto: 0, ecommerceOrdini: 0,
    omniaAiLordo: 0, omniaAiNetto: 0, abbonamentiNetto: 0, creditiNetto: 0, revisioniNetto: 0, pianiLavoroNetto: 0, pacchettiNetto: 0, copertineNetto: 0, incassiAbbonamento: 0, acquistiCrediti: 0, acquistiRevisione: 0, acquistiPianoLavoro: 0, acquistiPacchetto: 0, acquistiCopertina: 0,
  };
  let provaVoci = 0;
  let provaLordo = 0;
  let dateApprossimate = 0;
  let ivaStimata = false;

  for (const v of voci) {
    // il periodo comincia e finisce a mezzanotte di Roma: si confrontano i giorni di calendario di Roma
    const giorno = dataRoma(new Date(v.data));
    if (giorno < periodo.da || giorno > periodo.a) continue;

    if (v.prova) {
      provaVoci++;
      provaLordo += v.lordo;
      if (!includiProva) continue;
    }

    const { netto, stimato } = nettoVoce(v, aliquotaIva);
    if (stimato) ivaStimata = true;
    if (v.dataApprossimata) dateApprossimate++;

    totali.lordo += v.lordo;
    totali.netto += netto;
    const mese = mesi.get(giorno.slice(0, 7));

    if (v.dominio === "ecommerce") {
      totali.ecommerceLordo += v.lordo;
      totali.ecommerceNetto += netto;
      totali.ecommerceOrdini++;
      if (mese) mese.ecommerce += netto;
    } else {
      totali.omniaAiLordo += v.lordo;
      totali.omniaAiNetto += netto;
      if (v.fonte === "crediti") {
        totali.creditiNetto += netto;
        totali.acquistiCrediti++;
        if (mese) mese.crediti += netto;
      } else if (v.fonte === "revisione") {
        totali.revisioniNetto += netto;
        totali.acquistiRevisione++;
        if (mese) mese.revisioni += netto;
      } else if (v.fonte === "piano_lavoro") {
        totali.pianiLavoroNetto += netto;
        totali.acquistiPianoLavoro++;
        if (mese) mese.pianiLavoro += netto;
      } else if (v.fonte === "pacchetto") {
        totali.pacchettiNetto += netto;
        totali.acquistiPacchetto++;
        if (mese) mese.pacchetti += netto;
      } else if (v.fonte === "copertina") {
        totali.copertineNetto += netto;
        totali.acquistiCopertina++;
        if (mese) mese.copertine += netto;
      } else {
        totali.abbonamentiNetto += netto;
        totali.incassiAbbonamento++;
        if (mese) mese.abbonamenti += netto;
      }
    }
    if (mese) mese.totale += netto;
  }

  return {
    totali,
    perMese: [...mesi.values()],
    prova: { voci: provaVoci, lordo: provaLordo, incluse: includiProva },
    dateApprossimate,
    ivaStimata,
  };
}

// Il giorno dopo l'ultimo giorno del periodo: serve a chi confronta con date esclusive.
export function giornoDopo(periodo: Periodo): string {
  return aggiungiGiorni(periodo.a, 1);
}
