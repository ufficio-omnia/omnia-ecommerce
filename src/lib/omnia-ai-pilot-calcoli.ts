import { PIANI_ORDINE, formatEuro, type PianoSlug } from "./omnia-ai-plans";
import { erroreListino, euroACentesimi, formattaGiorno, giornoRoma, DURATA_MAX_MESI } from "./omnia-ai-catalogo-calcoli";

// Calcoli puri (nessun database, nessuna rete) dell'offerta pilot di OMNIA AI (migrazione 0086):
// un prezzo mensile dedicato a un cliente creato dalla console, per N mesi (0 = sempre), con un
// promemoria negli ultimi 15 giorni. Dopo i mesi indicati il prezzo torna al pieno: lo fa Stripe
// da solo (coupon a durata), qui si calcolano le date e i testi.

export const GIORNI_PREAVVISO_PILOT = 15;
const MS_GIORNO = 24 * 60 * 60 * 1000;

export type OffertaPilot = {
  id: string;
  userId: string;
  piano: PianoSlug;
  prezzoCentesimi: number;
  mesi: number;
  attiva: boolean;
  creataIl: string;
  creataDa: string;
  acquistataIl: string | null;
  scadeIl: string | null;
  prezzoPienoCentesimi: number | null;
  promemoriaInviatoIl: string | null;
};

export type StatoOffertaPilot = "aperta" | "revocata" | "acquistata";

export function statoOffertaPilot(o: Pick<OffertaPilot, "attiva" | "acquistataIl">): StatoOffertaPilot {
  if (o.acquistataIl) return "acquistata";
  return o.attiva ? "aperta" : "revocata";
}

// Il prezzo pilot non può superare il listino: sopra, l'offerta non sarebbe un'offerta e il
// cliente pagherebbe il listino. Si ritorna sempre il più basso dei due.
export function prezzoPilotEffettivo(listino: number, prezzoPilot: number): number {
  return Math.min(listino, prezzoPilot);
}

export function risparmioPilot(listino: number, prezzoPilot: number): number {
  return Math.max(0, listino - prezzoPilot);
}

export type NuovaOffertaPilotInput = { piano: string; prezzo: string; mesi: string };
export type NuovaOffertaPilotValida = { piano: PianoSlug; prezzoCentesimi: number; mesi: number };

export function validaNuovaOffertaPilot(input: NuovaOffertaPilotInput, listini: Record<PianoSlug, number>): { ok: true; valori: NuovaOffertaPilotValida } | { ok: false; errore: string } {
  const pianoGrezzo = input.piano.trim();
  if (!PIANI_ORDINE.includes(pianoGrezzo as PianoSlug)) return { ok: false, errore: "Scegli il piano da offrire." };
  const piano = pianoGrezzo as PianoSlug;

  const prezzoCentesimi = euroACentesimi(input.prezzo);
  const errorePrezzo = erroreListino(prezzoCentesimi);
  if (errorePrezzo || prezzoCentesimi === null) return { ok: false, errore: errorePrezzo ?? "Prezzo non valido." };
  if (prezzoCentesimi >= listini[piano]) return { ok: false, errore: `Il prezzo pilot deve essere inferiore al listino del piano (${formatEuro(listini[piano])}): altrimenti non è un'offerta.` };

  const mesiGrezzi = input.mesi.trim();
  const mesi = mesiGrezzi === "" ? 0 : Number(mesiGrezzi);
  if (!Number.isInteger(mesi) || mesi < 0 || mesi > DURATA_MAX_MESI) return { ok: false, errore: `I mesi di prezzo pilot devono essere un numero intero da 0 a ${DURATA_MAX_MESI} (0 = sempre il prezzo pilot).` };

  return { ok: true, valori: { piano, prezzoCentesimi, mesi } };
}

// Il testo dell'offerta nell'area riservata del cliente (e nell'anteprima in console).
export function testoOffertaPilot(o: Pick<OffertaPilot, "prezzoCentesimi" | "mesi">, nomePiano: string, listino: number): string {
  const prezzo = formatEuro(prezzoPilotEffettivo(listino, o.prezzoCentesimi));
  if (o.mesi === 0) return `Offerta riservata a te: piano ${nomePiano} a ${prezzo} al mese, IVA inclusa, per tutta la durata dell'abbonamento.`;
  const durata = o.mesi === 1 ? "per il primo mese" : `per i primi ${o.mesi} mesi`;
  return `Offerta riservata a te: piano ${nomePiano} a ${prezzo} al mese, IVA inclusa, ${durata}. Poi il rinnovo avviene a prezzo pieno: ${formatEuro(listino)} al mese.`;
}

// Aggiunge N mesi di calendario (stesso giorno del mese, o l'ultimo se il mese di arrivo è più corto).
// Serve solo come ripiego se Stripe non restituisse la data di fine dello sconto.
export function aggiungiMesi(da: Date, mesi: number): Date {
  const d = new Date(da.getTime());
  const giorno = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + mesi);
  const ultimo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(giorno, ultimo));
  return d;
}

// La fine dello sconto di un abbonamento Stripe: nell'elenco `discounts` (espanso) ogni sconto ha `end`
// (secondi Unix, null se non finisce mai). Un elemento non espanso (solo l'identificativo) non dice nulla.
export function fineScontoStripe(sconti: ({ end?: number | null } | string)[] | null | undefined): number | null {
  for (const s of sconti ?? []) {
    if (typeof s === "string") continue;
    if (typeof s.end === "number" && Number.isFinite(s.end)) return s.end;
  }
  return null;
}

// Quando finisce il prezzo pilot. Con mesi = 0 non finisce mai (null), qualunque cosa dica Stripe. Con
// mesi ≠ 0 vale la data dello sconto dichiarata da Stripe; se manca si calcola dai mesi.
export function scadenzaPilot(mesi: number, fineScontoUnix: number | null, adesso: Date): Date | null {
  if (mesi === 0) return null;
  return fineScontoUnix !== null ? new Date(fineScontoUnix * 1000) : aggiungiMesi(adesso, mesi);
}

export type PromemoriaPilot = { giorni: number; scadeIlGiorno: string };

// Il promemoria dei «ultimi 15 giorni»: c'è solo per un'offerta acquistata con una scadenza (mesi ≠ 0),
// da 15 giorni prima fino al momento della scadenza. `giorni` è quanti giorni mancano (arrotondati per
// eccesso, minimo 1 finché non è scaduta).
export function promemoriaPilot(o: Pick<OffertaPilot, "acquistataIl" | "scadeIl">, adesso: Date): PromemoriaPilot | null {
  if (!o.acquistataIl || !o.scadeIl) return null;
  const scade = Date.parse(o.scadeIl);
  if (!Number.isFinite(scade)) return null;
  const mancano = scade - adesso.getTime();
  if (mancano <= 0) return null;
  if (mancano > GIORNI_PREAVVISO_PILOT * MS_GIORNO) return null;
  return { giorni: Math.max(1, Math.ceil(mancano / MS_GIORNO)), scadeIlGiorno: giornoRoma(new Date(scade)) };
}

export function testoPromemoriaPilot(p: PromemoriaPilot, prezzoPienoCentesimi: number): string {
  const fra = p.giorni === 1 ? "domani" : `fra ${p.giorni} giorni`;
  return `Il tuo prezzo pilot scade ${fra}, il ${formattaGiorno(p.scadeIlGiorno)}. Dopo quella data l'abbonamento si rinnova a prezzo pieno: ${formatEuro(prezzoPienoCentesimi)} al mese, IVA inclusa.`;
}

// Cosa mostra la pagina Abbonamento a chi ha un pilot in corso.
export function testoPilotInCorso(o: Pick<OffertaPilot, "prezzoCentesimi" | "mesi" | "scadeIl" | "prezzoPienoCentesimi">): string {
  const prezzo = formatEuro(o.prezzoCentesimi);
  if (o.mesi === 0 || !o.scadeIl) return `Hai un prezzo dedicato: ${prezzo} al mese, IVA inclusa, per tutta la durata dell'abbonamento.`;
  const pieno = o.prezzoPienoCentesimi ? ` Dopo, il rinnovo sarà a prezzo pieno: ${formatEuro(o.prezzoPienoCentesimi)} al mese.` : " Dopo, il rinnovo sarà a prezzo pieno.";
  return `Hai un prezzo pilot: ${prezzo} al mese, IVA inclusa, fino al ${formattaGiorno(giornoRoma(new Date(o.scadeIl)))}.${pieno}`;
}

// ───── Catalogo con l'offerta pilot ─────

// Il catalogo come lo vede QUESTO cliente: il piano offerto mostra il prezzo pilot al posto del prezzo
// di oggi, con lo stesso aspetto di uno sconto (listino barrato, prezzo, frase dell'offerta); gli altri
// piani restano com'erano. Se il prezzo pilot non è inferiore al listino non è un'offerta: nulla cambia.
// `pianoPredefinito` è il piano da selezionare in partenza nel modulo di acquisto.
export function applicaPilotAlCatalogo<T extends { slug: PianoSlug; prezzoListinoCentesimi: number; prezzoCentesimi: number; sconto: unknown }>(
  piani: T[],
  offerta: Pick<OffertaPilot, "id" | "piano" | "prezzoCentesimi" | "mesi"> | null,
): { piani: T[]; pianoPredefinito: PianoSlug | null } {
  if (!offerta) return { piani, pianoPredefinito: null };
  const risparmio = (listino: number) => risparmioPilot(listino, offerta.prezzoCentesimi);
  const offerto = piani.find((p) => p.slug === offerta.piano);
  if (!offerto || risparmio(offerto.prezzoListinoCentesimi) <= 0) return { piani, pianoPredefinito: null };

  return {
    piani: piani.map((p) =>
      p.slug !== offerta.piano
        ? p
        : {
            ...p,
            prezzoCentesimi: prezzoPilotEffettivo(p.prezzoListinoCentesimi, offerta.prezzoCentesimi),
            sconto: {
              id: offerta.id,
              nome: "Offerta riservata a te",
              tipo: "prezzo" as const,
              percentuale: null,
              validoAl: null,
              durataMesi: offerta.mesi,
              prezzoCentesimi: prezzoPilotEffettivo(p.prezzoListinoCentesimi, offerta.prezzoCentesimi),
              risparmioCentesimi: risparmio(p.prezzoListinoCentesimi),
            },
          },
    ),
    pianoPredefinito: offerta.piano,
  };
}

// Il prezzo pilot è ancora «in corso»: acquistato e, se ha una scadenza, non ancora scaduta.
export function pilotInCorso(o: Pick<OffertaPilot, "acquistataIl" | "scadeIl" | "mesi">, adesso: Date): boolean {
  if (!o.acquistataIl) return false;
  if (o.mesi === 0 || !o.scadeIl) return true;
  return Date.parse(o.scadeIl) > adesso.getTime();
}
