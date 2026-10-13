import { normalizzaPianoSlug, PIANI } from "@/lib/omnia-ai-plans";
import { fineAbbonamento, type AbbonamentoRiga } from "./costi-calcoli";
import { dataRoma } from "./giorni-lavorativi";
import type { Periodo } from "./periodo";

// Calcoli puri (nessun database) sugli abbonamenti OMNIA AI.
//
// COSA SI CONTA. Si contano CLIENTI (utenti), non righe: un utente può avere più
// righe di abbonamento (ricreato, riattivato). Le righe create a mano dall'admin
// (senza abbonamento Stripe) non sono clienti paganti e restano fuori dai
// conteggi; quelle di prova (Stripe in modalità test) escono se non richieste.
//
// STATI. Stato di un cliente = stato della sua riga più recente, con la stessa
// regola dell'area riservata (src/lib/omnia-ai-access.ts, da tenere allineata):
//  - attivo: abbonamento attivo e periodo pagato non scaduto;
//  - sola lettura: i 30 giorni dopo la fine dell'ultimo periodo pagato;
//  - cessato: oltre i 30 giorni (o abbonamento non attivo senza data di fine).
// "In disdetta" = attivo con la disdetta già richiesta, ancora valido fino a fine periodo.
//
// PERIODO. Nuovi = clienti la cui prima riga nasce nel periodo. Cessati nel
// periodo = clienti la cui cessazione (fine periodo pagato + 30 giorni) cade nel
// periodo. Abbandono = (clienti attivi il primo giorno del periodo che NON lo
// sono più alla fine) ÷ (clienti attivi il primo giorno). "Attivo il giorno G" si
// ricostruisce dagli intervalli delle righe (created_at → fine periodo pagato).
// Le disdette richieste hanno una data solo da quando la migrazione 0078 è attiva.

const GIORNI_SOLA_LETTURA = 30;
const MS_GIORNO = 24 * 60 * 60 * 1000;

export type AbbonamentoDb = AbbonamentoRiga & {
  user_id: string;
  livemode: boolean | null;
  disdetta_richiesta_il: string | null;
  terminata_il: string | null;
};

export type StatoAbbonamento = "attivo" | "sola_lettura" | "cessato";

export function statoAbbonamento(
  riga: Pick<AbbonamentoRiga, "status" | "current_period_end">,
  adesso: Date,
): { stato: StatoAbbonamento; cessatoIl: Date | null } {
  const fine = riga.current_period_end ? new Date(riga.current_period_end) : null;
  const periodoScaduto = fine !== null && fine.getTime() <= adesso.getTime();
  if (riga.status === "attivo" && !periodoScaduto) return { stato: "attivo", cessatoIl: null };
  if (!fine) return { stato: "cessato", cessatoIl: null };

  const cessatoIl = new Date(fine.getTime() + GIORNI_SOLA_LETTURA * MS_GIORNO);
  const giorniTrascorsi = (adesso.getTime() - fine.getTime()) / MS_GIORNO;
  return { stato: giorniTrascorsi < GIORNI_SOLA_LETTURA ? "sola_lettura" : "cessato", cessatoIl };
}

export type ClienteAbbonamento = {
  userId: string;
  // slug del catalogo, o il testo grezzo se fuori catalogo
  piano: string;
  stato: StatoAbbonamento;
  inDisdetta: boolean;
  // AAAA-MM-GG della prima riga
  inizio: string;
  // fine dell'ultimo periodo pagato, AAAA-MM-GG
  finePeriodo: string | null;
  disdettaRichiestaIl: string | null;
  // quando diventa/è diventato cessato, AAAA-MM-GG
  cessatoIl: string | null;
  prova: boolean;
};

export type MetricheAbbonamenti = {
  clienti: ClienteAbbonamento[];
  // fotografia di oggi
  attivi: number;
  inDisdetta: number;
  solaLettura: number;
  cessati: number;
  mrrLordo: number;
  // del periodo
  nuovi: number;
  disdetteRichieste: number;
  cessatiNelPeriodo: number;
  attiviInizioPeriodo: number;
  persi: number;
  // null se all'inizio del periodo non c'erano clienti attivi (o il periodo è tutto nel futuro)
  abbandono: number | null;
  // clienti con almeno una disdetta datata: dice quanto la cifra "disdette richieste" è affidabile
  conDataDisdetta: number;
  esclusi: { prova: number; manuali: number };
};

type Intervallo = { da: string; a: string | null };

function intervalloRiga(r: AbbonamentoDb): Intervallo {
  const inizio = dataRoma(new Date(r.created_at));
  return { da: inizio, a: fineAbbonamento(r) };
}

function attivoIl(intervalli: Intervallo[], giorno: string): boolean {
  return intervalli.some((i) => i.da <= giorno && (i.a === null || giorno < i.a));
}

const ORDINE_STATO: Record<StatoAbbonamento, number> = { attivo: 0, sola_lettura: 1, cessato: 2 };

export function calcolaMetriche(righe: AbbonamentoDb[], periodo: Periodo, adesso: Date, includiProva: boolean): MetricheAbbonamenti {
  const oggi = dataRoma(adesso);
  const perUtente = new Map<string, AbbonamentoDb[]>();
  const soloManuali = new Set<string>();
  const soloProva = new Set<string>();

  const conStripe = righe.filter((r) => r.stripe_subscription_id);
  for (const r of righe) if (!r.stripe_subscription_id) soloManuali.add(r.user_id);
  for (const r of conStripe) {
    soloManuali.delete(r.user_id);
  }
  for (const r of conStripe) {
    if (r.livemode === false && !includiProva) continue;
    perUtente.set(r.user_id, [...(perUtente.get(r.user_id) ?? []), r]);
  }
  for (const r of conStripe) if (!perUtente.has(r.user_id)) soloProva.add(r.user_id);

  const clienti: ClienteAbbonamento[] = [];
  let attivi = 0;
  let inDisdetta = 0;
  let solaLettura = 0;
  let cessati = 0;
  let mrrLordo = 0;
  let nuovi = 0;
  let disdetteRichieste = 0;
  let cessatiNelPeriodo = 0;
  let attiviInizioPeriodo = 0;
  let persi = 0;
  let conDataDisdetta = 0;

  const fineEffettiva = periodo.a < oggi ? periodo.a : oggi;
  const periodoFuturo = periodo.da > oggi;

  for (const [userId, righeUtente] of perUtente) {
    const ordinate = [...righeUtente].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const ultima = ordinate[ordinate.length - 1];
    const { stato, cessatoIl } = statoAbbonamento(ultima, adesso);
    const disdetta = stato === "attivo" && Boolean(ultima.cancel_at_period_end);
    const intervalli = ordinate.map(intervalloRiga);
    const inizio = intervalli[0].da;
    const piano = normalizzaPianoSlug(ultima.plan);
    const cessatoGiorno = cessatoIl ? dataRoma(cessatoIl) : null;
    const datiDisdetta = ordinate.filter((r) => r.disdetta_richiesta_il).map((r) => dataRoma(new Date(r.disdetta_richiesta_il as string)));

    clienti.push({
      userId,
      piano: piano ?? ultima.plan,
      stato,
      inDisdetta: disdetta,
      inizio,
      finePeriodo: ultima.current_period_end ? dataRoma(new Date(ultima.current_period_end)) : null,
      disdettaRichiestaIl: ultima.disdetta_richiesta_il ? dataRoma(new Date(ultima.disdetta_richiesta_il)) : null,
      cessatoIl: cessatoGiorno,
      prova: ultima.livemode === false,
    });

    if (stato === "attivo") {
      attivi++;
      if (piano) mrrLordo += PIANI[piano].prezzoCentesimi / 100;
    }
    if (disdetta) inDisdetta++;
    if (stato === "sola_lettura") solaLettura++;
    if (stato === "cessato") cessati++;

    if (inizio >= periodo.da && inizio <= periodo.a) nuovi++;
    if (datiDisdetta.length > 0) conDataDisdetta++;
    if (datiDisdetta.some((g) => g >= periodo.da && g <= periodo.a)) disdetteRichieste++;
    if (stato === "cessato" && cessatoGiorno && cessatoGiorno >= periodo.da && cessatoGiorno <= periodo.a) cessatiNelPeriodo++;

    if (!periodoFuturo && attivoIl(intervalli, periodo.da)) {
      attiviInizioPeriodo++;
      if (!attivoIl(intervalli, fineEffettiva)) persi++;
    }
  }

  clienti.sort((a, b) => ORDINE_STATO[a.stato] - ORDINE_STATO[b.stato] || b.inizio.localeCompare(a.inizio));

  return {
    clienti,
    attivi,
    inDisdetta,
    solaLettura,
    cessati,
    mrrLordo,
    nuovi,
    disdetteRichieste,
    cessatiNelPeriodo,
    attiviInizioPeriodo,
    persi,
    abbandono: attiviInizioPeriodo > 0 ? persi / attiviInizioPeriodo : null,
    conDataDisdetta,
    esclusi: { prova: includiProva ? 0 : soloProva.size, manuali: soloManuali.size },
  };
}
