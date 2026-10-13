import { PACCHETTI_CREDITI, PIANI, normalizzaPianoSlug } from "./omnia-ai-plans";

// Calcoli puri (nessun database) per la pagina «Pagamenti e fatture» dell'area
// riservata di OMNIA AI: lo storico dei pagamenti dell'abbonamento (primo pagamento,
// rinnovi, conguagli di cambio piano) e degli acquisti di crediti, ciascuno con lo stato
// della sua fattura.
//
// Solo OMNIA AI: gli ordini dell'e-commerce non compaiono qui, sono un altro prodotto
// con la sua area riservata.

type CampiFattura = {
  stato_fattura?: string | null;
  numero_fattura?: string | null;
  data_fattura?: string | null;
  fattura_file_path?: string | null;
};

export type IncassoCliente = CampiFattura & {
  id: string;
  tipo: string;
  importo_lordo_centesimi: number;
  pagato_il: string;
  livemode: boolean;
  numero_ricevuta: string | null;
  ricevuta_url: string | null;
  stripe_subscription_id: string | null;
};

export type AcquistoCrediti = CampiFattura & {
  id: string;
  pacchetto: string;
  crediti: number;
  importo_centesimi: number;
  created_at: string;
};

export type AbbonamentoCliente = { stripe_subscription_id: string | null; plan: string };

// Cosa vede il cliente della fattura di un pagamento. La differenza tra «disponibile» e
// «emessa» è il PDF: la fattura può essere stata emessa (numero e data segnati) senza che
// il file sia stato caricato; allora non c'è nulla da scaricare e non si finge il contrario.
export type StatoFatturaCliente =
  | { tipo: "disponibile"; numero: string | null; data: string | null }
  | { tipo: "emessa"; numero: string | null; data: string | null }
  | { tipo: "in_preparazione" }
  | { tipo: "non_dovuta" };

export function statoFatturaCliente(r: CampiFattura): StatoFatturaCliente {
  if (r.stato_fattura === "fatturata") {
    const comune = { numero: r.numero_fattura ?? null, data: r.data_fattura ?? null };
    return r.fattura_file_path ? { tipo: "disponibile", ...comune } : { tipo: "emessa", ...comune };
  }
  if (r.stato_fattura === "non_dovuta") return { tipo: "non_dovuta" };
  // «da fatturare», colonna assente (migrazione non ancora eseguita) o valore sconosciuto:
  // per il cliente la fattura è semplicemente in arrivo
  return { tipo: "in_preparazione" };
}

export type PagamentoCliente = {
  // «incasso:<uuid>» o «crediti:<uuid>»
  chiave: string;
  fonte: "incasso" | "crediti";
  id: string;
  data: string;
  descrizione: string;
  importoCentesimi: number;
  // pagamento fatto con Stripe in modalità di prova
  prova: boolean;
  numeroRicevuta: string | null;
  ricevutaUrl: string | null;
  fattura: StatoFatturaCliente;
};

export function descrizioneIncasso(tipo: string, piano: string | null): string {
  const slug = normalizzaPianoSlug(piano);
  const nome = slug ? ` ${PIANI[slug].nome}` : "";
  const dettaglio: Record<string, string> = { primo: "primo pagamento", rinnovo: "rinnovo mensile", conguaglio: "conguaglio per cambio piano" };
  return `Abbonamento OMNIA AI${nome}${dettaglio[tipo] ? `: ${dettaglio[tipo]}` : ""}`;
}

export function descrizioneCrediti(pacchetto: string, crediti: number): string {
  const noto = PACCHETTI_CREDITI[pacchetto as keyof typeof PACCHETTI_CREDITI];
  if (noto) return `${noto.nome} OMNIA AI`;
  return `Crediti aggiuntivi OMNIA AI (${crediti} ${crediti === 1 ? "gara" : "gare"})`;
}

// Un solo elenco, dal pagamento più recente.
export function costruisciPagamenti(incassi: IncassoCliente[], acquisti: AcquistoCrediti[], abbonamenti: AbbonamentoCliente[]): PagamentoCliente[] {
  const pianoPerAbbonamento = new Map(abbonamenti.filter((a) => a.stripe_subscription_id).map((a) => [a.stripe_subscription_id as string, a.plan]));

  const dagliIncassi = incassi.map<PagamentoCliente>((i) => ({
    chiave: `incasso:${i.id}`,
    fonte: "incasso",
    id: i.id,
    data: i.pagato_il,
    descrizione: descrizioneIncasso(i.tipo, i.stripe_subscription_id ? (pianoPerAbbonamento.get(i.stripe_subscription_id) ?? null) : null),
    importoCentesimi: Number(i.importo_lordo_centesimi),
    prova: !i.livemode,
    numeroRicevuta: i.numero_ricevuta,
    ricevutaUrl: i.ricevuta_url,
    fattura: statoFatturaCliente(i),
  }));

  const daiCrediti = acquisti.map<PagamentoCliente>((a) => ({
    chiave: `crediti:${a.id}`,
    fonte: "crediti",
    id: a.id,
    data: a.created_at,
    descrizione: descrizioneCrediti(a.pacchetto, Number(a.crediti)),
    importoCentesimi: Number(a.importo_centesimi),
    // gli acquisti di crediti non hanno un campo «livemode»: la prova non si distingue qui,
    // ma un cliente vero non ne ha (le sessioni di prova appartengono ad account di prova)
    prova: false,
    numeroRicevuta: null,
    ricevutaUrl: null,
    fattura: statoFatturaCliente(a),
  }));

  return [...dagliIncassi, ...daiCrediti].sort((a, b) => b.data.localeCompare(a.data));
}

// ───── Collegamento di download ─────

export const CHIAVE_PAGAMENTO = /^(incasso|crediti)$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const TABELLA_PER_FONTE = { incasso: "omnia_ai_incassi", crediti: "omnia_ai_credit_purchases" } as const;

// Dove sta il file di una fattura nel bucket privato «invoices»: un file solo per pagamento,
// quindi ricaricarlo lo sostituisce.
export function percorsoFatturaPagamento(fonte: keyof typeof TABELLA_PER_FONTE, id: string): string {
  if (!UUID.test(id)) throw new Error("Identificativo di pagamento non valido");
  return `omnia-ai/${fonte === "incasso" ? "incassi" : "crediti"}/${id}.pdf`;
}

// Nome con cui il cliente salva il file: «Fattura-OMNIA-AI-2026-045.pdf» o, senza numero,
// con la data del pagamento. Niente caratteri che non stiano in un'intestazione HTTP.
export function nomeFileFattura(numero: string | null, dataPagamento: string): string {
  const base = (numero ?? "").replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || dataPagamento.slice(0, 10);
  return `Fattura-OMNIA-AI-${base}.pdf`;
}
